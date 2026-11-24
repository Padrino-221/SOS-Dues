import {randomBytes,randomUUID} from 'node:crypto';
export const provisioningSchema=`
CREATE TABLE IF NOT EXISTS staff_sso_managed_accounts(
 app_id text NOT NULL,hub_staff_id uuid NOT NULL,account_kind text NOT NULL,local_user_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(app_id,hub_staff_id,account_kind),UNIQUE(app_id,local_user_id));
CREATE TABLE IF NOT EXISTS staff_sso_provision_events(
 id bigserial PRIMARY KEY,app_id text NOT NULL,hub_staff_id uuid NOT NULL,local_user_id text NOT NULL,
 role text NOT NULL,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());`;
const reject=(message,status=409)=>Object.assign(new Error(message),{status});
const allowed={attendance:['lecturer','university','school','department'],dues:['dept_staff','dept_admin','school_staff','school_admin','super_admin'],'document-tracker':['LECTURER','HOD','DEAN','ADMIN'],spms:['LECTURER','ADMIN','DEAN'],'school-cms':['EDITOR','ADMIN']};
export function createProvisioner({appId,transaction,hashPassword,universityId=process.env.STAFF_SSO_UNIVERSITY_ID,schoolId=process.env.STAFF_SSO_SCHOOL_ID}){
 if(!Object.hasOwn(allowed,appId))throw Error('Unknown provisioning application');
 return async function provision(value){
  if(process.env.STAFF_SSO_AUTO_PROVISION!=='true')return value.existingLocalId||null;
  const kind=appId==='attendance'?(value.role==='lecturer'?'lecturer':'admin'):appId;
  return transaction(async query=>{
   await query('SELECT pg_advisory_xact_lock(hashtext($1))::text AS locked',[`staff-provision:${appId}:${value.hubStaffId}`]);
   const links=await query('SELECT local_user_id FROM staff_sso_links WHERE app_id=$1 AND hub_staff_id=$2::uuid FOR UPDATE',[appId,value.hubStaffId]);
   const managed=await query('SELECT * FROM staff_sso_managed_accounts WHERE app_id=$1 AND hub_staff_id=$2::uuid',[appId,value.hubStaffId]);
   // A reviewed legacy link stays unchanged. Never adopt an existing account by email.
   if(links[0]&&!managed.some(m=>m.local_user_id===links[0].local_user_id))return links[0].local_user_id;
   if(!allowed[appId].includes(value.role))throw reject('Choose an explicit application role before opening this system.',400);
   if(!/^[a-f0-9-]{36}$/i.test(value.hubStaffId)||!value.name?.trim()||!/^\S+@\S+\.\S+$/.test(value.email||''))throw reject('The central staff profile is incomplete.',400);
   const email=value.email.trim().toLowerCase(),name=value.name.trim(),dep=value.departmentId||null;
   if((['lecturer','LECTURER','HOD','dept_staff','dept_admin'].includes(value.role)||appId==='attendance'&&value.role==='department')&&!dep)throw reject('Assign a mapped department in Staff Access before opening this system.',400);
   if(appId==='attendance'&&dep){const d=(await query('SELECT d.school_id,s.university_id FROM departments d JOIN schools s ON s.id=d.school_id WHERE d.id::text=$1 AND d.deleted_at IS NULL',[dep]))[0];if(!d||String(d.university_id)!==String(universityId)||schoolId&&String(d.school_id)!==String(schoolId))throw reject('The mapped department is unavailable in this institution.',503);}
   let table,prefix='';
   if(appId==='attendance'){table=kind==='lecturer'?'lecturers':'admins';prefix=kind+':';}
   else if(appId==='spms')table='staff';else table='users';
   const owner=managed.find(m=>m.account_kind===kind);
   const nativeId=owner?(prefix?owner.local_user_id.slice(prefix.length):owner.local_user_id):null;
   await query('SELECT pg_advisory_xact_lock(hashtext($1))::text AS locked',[`staff-provision-email:${appId}:${kind}:${email}`]);
   const collisions=await query(`SELECT id::text AS id FROM ${table} WHERE lower(email)=$1 AND ($2::text IS NULL OR id::text<>$2)`,[email,nativeId]);
   if(collisions.length)throw reject('This email already has an application account. An administrator must review and connect that existing account.');
   let row;
   if(nativeId){
    row=(await query(`SELECT * FROM ${table} WHERE id::text=$1`,[nativeId]))[0];
    if(!row||row.deleted_at||row.active===false||appId==='spms'&&!row.spmsAccess)throw reject('The managed application account is disabled or unavailable. Contact your administrator.');
   }
   const creating=!row,password=creating?await hashPassword(randomBytes(48).toString('base64url')):null;
   const uuid=appId==='document-tracker'?randomUUID():'c'+randomBytes(12).toString('hex');
   let result;
   if(appId==='attendance'){
    if(kind==='lecturer'){
     result=creating?await query('INSERT INTO lecturers(name,email,password_hash,department_id,pwd_changed_at) VALUES($1,$2,$3,$4::integer,now()) RETURNING id::text AS id',[name,email,password,dep])
      :await query('UPDATE lecturers SET name=$1,email=$2,department_id=$3::integer WHERE id::text=$4 AND (name IS DISTINCT FROM $1 OR email IS DISTINCT FROM $2 OR department_id IS DISTINCT FROM $3::integer) RETURNING id::text AS id',[name,email,dep,nativeId]);
    }else{
     if(!/^\d+$/.test(String(universityId||''))||value.role==='school'&&!/^\d+$/.test(String(schoolId||'')))throw reject('Attendance institution provisioning is not configured.',503);
     let university=String(universityId),school=value.role==='school'?String(schoolId):null,department=value.role==='department'?dep:null;
     if(department){const d=(await query('SELECT d.school_id,s.university_id FROM departments d JOIN schools s ON s.id=d.school_id WHERE d.id::text=$1 AND d.deleted_at IS NULL',[department]))[0];if(!d||String(d.university_id)!==university)throw reject('The mapped department is outside the configured university.');school=String(d.school_id);}
     if(school){const s=(await query('SELECT id FROM schools WHERE id::text=$1 AND university_id::text=$2',[school,university]))[0];if(!s)throw reject('The configured school is outside the university.');}
     result=creating?await query('INSERT INTO admins(name,email,password_hash,role,university_id,school_id,department_id,pwd_changed_at) VALUES($1,$2,$3,$4,$5::integer,$6::integer,$7::integer,now()) RETURNING id::text AS id',[name,email,password,value.role,university,school,department])
      :await query('UPDATE admins SET name=$1,email=$2,role=$3,university_id=$4::integer,school_id=$5::integer,department_id=$6::integer WHERE id::text=$7 AND (name IS DISTINCT FROM $1 OR email IS DISTINCT FROM $2 OR role IS DISTINCT FROM $3 OR university_id IS DISTINCT FROM $4::integer OR school_id IS DISTINCT FROM $5::integer OR department_id IS DISTINCT FROM $6::integer) RETURNING id::text AS id',[name,email,value.role,university,school,department,nativeId]);
    }
   }else if(appId==='dues'){
    result=creating?await query('INSERT INTO users(name,email,password_hash,role,department_id) VALUES($1,$2,$3,$4,$5::integer) RETURNING id::text AS id',[name,email,password,value.role,dep])
     :await query('UPDATE users SET name=$1,email=$2,role=$3,department_id=$4::integer WHERE id::text=$5 AND (name IS DISTINCT FROM $1 OR email IS DISTINCT FROM $2 OR role IS DISTINCT FROM $3 OR department_id IS DISTINCT FROM $4::integer) RETURNING id::text AS id',[name,email,value.role,dep,nativeId]);
   }else if(appId==='document-tracker'){
    result=creating?await query('INSERT INTO users(id,full_name,email,password_hash,role,department_id) VALUES($1::uuid,$2,$3,$4,$5::"Role",$6::uuid) RETURNING id::text AS id',[uuid,name,email,password,value.role,dep])
     :await query('UPDATE users SET full_name=$1,email=$2,role=$3::"Role",department_id=$4::uuid WHERE id=$5::uuid AND (full_name IS DISTINCT FROM $1 OR email IS DISTINCT FROM $2 OR role IS DISTINCT FROM $3::"Role" OR department_id IS DISTINCT FROM $4::uuid) RETURNING id::text AS id',[name,email,value.role,dep,nativeId]);
   }else if(appId==='school-cms'){
    result=creating?await query('INSERT INTO users(id,name,email,"passwordHash",role,active,"updatedAt") VALUES($1,$2,$3,$4,$5::"Role",true,now()) RETURNING id',[uuid,name,email,password,value.role])
     :await query('UPDATE users SET name=$1,email=$2,role=$3::"Role","updatedAt"=now() WHERE id=$4 AND (name IS DISTINCT FROM $1 OR email IS DISTINCT FROM $2 OR role IS DISTINCT FROM $3::"Role") RETURNING id',[name,email,value.role,nativeId]);
   }else if(appId==='spms'){
    result=creating?await query('INSERT INTO staff(id,name,email,"passwordHash","spmsRole","spmsAccess","spmsPasswordChanged","showOnPublic","departmentId","updatedAt") VALUES($1,$2,$3,$4,$5::"SpmsRole",true,true,false,$6,now()) RETURNING id',[uuid,name,email,password,value.role,dep])
     :await query('UPDATE staff SET name=$1,email=$2,"spmsRole"=$3::"SpmsRole","departmentId"=$4,"updatedAt"=now() WHERE id=$5 AND (name IS DISTINCT FROM $1 OR email IS DISTINCT FROM $2 OR "spmsRole" IS DISTINCT FROM $3::"SpmsRole" OR "departmentId" IS DISTINCT FROM $4) RETURNING id',[name,email,value.role,dep,nativeId]);
   }
   const localId=prefix+String(creating?result[0].id:nativeId);
   if(creating)await query('INSERT INTO staff_sso_managed_accounts(app_id,hub_staff_id,account_kind,local_user_id) VALUES($1,$2::uuid,$3,$4)',[appId,value.hubStaffId,kind,localId]);
   await query('INSERT INTO staff_sso_links(app_id,hub_staff_id,local_user_id) VALUES($1,$2::uuid,$3) ON CONFLICT(app_id,hub_staff_id) DO UPDATE SET local_user_id=EXCLUDED.local_user_id WHERE staff_sso_links.local_user_id IS DISTINCT FROM EXCLUDED.local_user_id',[appId,value.hubStaffId,localId]);
   if(creating||result.length||links[0]?.local_user_id!==localId)await query('INSERT INTO staff_sso_provision_events(app_id,hub_staff_id,local_user_id,role,action) VALUES($1,$2::uuid,$3,$4,$5)',[appId,value.hubStaffId,localId,value.role,creating?'created':result.length?'updated':'linked']);
   return localId;
  });
 };
}
