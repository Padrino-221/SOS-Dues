const {createHash,randomBytes}=require('crypto');
const jwt=require('jsonwebtoken');
const hash=v=>createHash('sha256').update(v).digest('hex');
const appId='dues';
const pool=require('../db/pool');
let adapter;
async function getAdapter(){return adapter??=Promise.all([import('./staff-sso-core.mjs'),import('./provision.mjs')]).then(([{createAdapter},{createProvisioner}])=>{
 const transaction=async fn=>{const db=await pool.connect();try{await db.query('BEGIN');const result=await fn(async(sql,values)=>(await db.query(sql,values)).rows);await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}};
 const provision=createProvisioner({appId,transaction,hashPassword:value=>require('bcryptjs').hash(value,12)});
 return createAdapter({appId,query:async(sql,values)=>(await pool.query(sql,values)).rows,provision});
});}

async function localUser(identity){
 const user=(await pool.query('SELECT id,name,email,role,department_id FROM users WHERE id::text=$1',[identity.localId])).rows[0];if(!user||!['dept_staff','dept_admin','school_staff','school_admin','super_admin'].includes(identity.role))return null;return {...user,role:identity.role,department_id:identity.departmentId};
}
async function authenticate(sid){const a=await getAdapter(),identity=await a.authenticate(sid);return identity?localUser(identity):null;}
async function linked(localId){return (await getAdapter()).linked(localId);}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(v=>{const i=v.indexOf('=');return i<0?[]:[v.slice(0,i).trim(),decodeURIComponent(v.slice(i+1))];}).filter(v=>v.length));}
function mount(router){
 const base='/staff-sso/'+appId;
 const cookieOptions={httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/api/auth/staff-sso/'+appId,maxAge:300000};
 router.get(base+'/login',async(req,res,next)=>{try{const a=await getAdapter(),flow=await a.start();res.cookie(a.flowCookie,flow.flow,cookieOptions);res.set('Cache-Control','no-store');res.redirect(flow.url);}catch(e){next(e);}});
 router.get(base+'/callback',async(req,res)=>{try{const a=await getAdapter();const result=await a.callback(process.env.STAFF_SSO_ORIGIN+req.originalUrl,cookies(req)[a.flowCookie]);res.clearCookie(a.flowCookie,cookieOptions);const user=await localUser(result.identity);if(!user)throw Error('The linked application account is unavailable.');const ticket=randomBytes(32).toString('base64url');await pool.query('DELETE FROM staff_sso_handoffs WHERE expires_at<now()');await pool.query("INSERT INTO staff_sso_handoffs(id,app_id,session_id,expires_at) VALUES($1,$2,$3,now()+interval '1 minute')",[hash(ticket),appId,result.sid]);res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.redirect(process.env.STAFF_SSO_ORIGIN+'/staff-sso/complete#ticket='+ticket);}catch(error){const {renderSignInError}=await import('./staff-sso-error.mjs');const {html,status}=renderSignInError(appId,error);res.status(status).set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}).type('html').send(html);}});
 router.post(base+'/logout',async(req,res)=>{try{const token=(req.headers.authorization||'').replace(/^Bearer /,'');const payload=jwt.verify(token,process.env.JWT_SECRET);if(payload.sso_sid)await(await getAdapter()).logout(payload.sso_sid);res.sendStatus(204);}catch{res.sendStatus(204);}});
 router.post(base+'/exchange',async(req,res,next)=>{try{if(req.headers.origin!==process.env.STAFF_SSO_ORIGIN)return res.status(403).json({error:'Invalid request origin.'});if(typeof req.body.ticket!=='string'||req.body.ticket.length>100)return res.status(400).json({error:'Invalid sign-in ticket.'});const row=(await pool.query('DELETE FROM staff_sso_handoffs WHERE id=$1 AND app_id=$2 AND expires_at>now() RETURNING session_id',[hash(req.body.ticket),appId])).rows[0];if(!row)return res.status(400).json({error:'This sign-in ticket has expired or was already used.'});const user=await authenticate(row.session_id);if(!user)return res.status(403).json({error:'Application access is unavailable.'});const token=jwt.sign({...user,sso_sid:row.session_id},process.env.JWT_SECRET,{expiresIn:'8h'});res.set('Cache-Control','no-store').json({token,user});}catch(e){next(e);}});
}
module.exports={getAdapter,authenticate,linked,mount};
