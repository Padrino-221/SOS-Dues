async function courseRepCollections(db,{where,params,departmentId,page,pageSize}) {
  const values=[...params];
  const department='$'+values.push(departmentId)+'::integer';
  const limit='$'+values.push(pageSize);
  const offset='$'+values.push((page-1)*pageSize);
  const {rows}=await db.query(`WITH scoped AS (
    SELECT r.id,r.receipt_number,r.record_type,r.department_id,SUM(p.amount) AS amount
    FROM receipts r JOIN payments p ON p.receipt_id=r.id LEFT JOIN students s ON s.id=r.student_id
    ${where} AND p.voided_at IS NULL AND p.type='school_dues'
    GROUP BY r.id
  ), actors AS (
    SELECT meta->>'receipt_id' AS receipt_id,
      COUNT(DISTINCT COALESCE(meta->>'course_rep_id','')||':'||COALESCE(meta->>'course_rep_email','')) AS identities,
      MIN(meta->>'course_rep_id') AS actor_id,MIN(meta->>'course_rep_email') AS email,
      MAX(meta->>'course_rep_name') AS actor_name
    FROM transaction_log WHERE transaction_type='payment' AND admin_role='REP'
      AND meta->>'receipt_id' IN (SELECT id::text FROM scoped WHERE record_type='rep')
    GROUP BY meta->>'receipt_id'
  ), identified AS (
    SELECT sc.*,CASE WHEN a.identities=1 THEN a.actor_id END actor_id,
      CASE WHEN a.identities=1 THEN a.email END email,
      CASE WHEN a.identities=1 THEN a.actor_name END actor_name
    FROM scoped sc LEFT JOIN actors a ON a.receipt_id=sc.id::text WHERE sc.record_type='rep'
  ), collected AS (
    SELECT COALESCE(c.id::text,CASE WHEN NULLIF(i.actor_id,'') IS NOT NULL
      THEN 'former:'||i.actor_id||':'||COALESCE(i.email,'') ELSE 'unattributed' END) AS collector_id,
      COALESCE(c.name,NULLIF(i.actor_name,''),CASE WHEN NULLIF(i.actor_id,'') IS NOT NULL
        THEN 'Former course rep'||CASE WHEN i.email IS NOT NULL THEN ' ('||i.email||')' ELSE '' END
        ELSE 'Course rep not recorded' END) AS name,
      i.department_id,COALESCE(d.name,'Department not recorded') AS department,SUM(i.amount) AS amount
    FROM identified i LEFT JOIN course_reps c ON c.id::text=i.actor_id
      AND (i.email IS NULL OR lower(c.email)=lower(i.email))
    LEFT JOIN departments d ON d.id=i.department_id
    GROUP BY 1,2,i.department_id,d.name
  ), report AS (
    SELECT * FROM collected
    UNION ALL
    SELECT c.id::text,c.name,c.department_id,d.name,0::numeric
    FROM course_reps c JOIN departments d ON d.id=c.department_id
    WHERE c.disabled_at IS NULL AND (${department} IS NULL OR c.department_id=${department})
      AND NOT EXISTS (SELECT 1 FROM collected x WHERE x.collector_id=c.id::text AND x.department_id=c.department_id)
  ) SELECT json_build_object(
    'course_reps',COALESCE((SELECT json_agg(x) FROM (SELECT * FROM report ORDER BY amount DESC,lower(name),department,collector_id LIMIT ${limit} OFFSET ${offset}) x),'[]'::json),
    'total',(SELECT COUNT(*) FROM report),
    'total_collected',COALESCE((SELECT SUM(amount) FROM scoped WHERE record_type='rep'),0),
    'other_collections',COALESCE((SELECT SUM(amount) FROM scoped WHERE record_type<>'rep'),0),
    'unattributed_amount',COALESCE((SELECT SUM(amount) FROM collected WHERE collector_id='unattributed'),0)
  ) AS report`,values);
  return {...rows[0].report,page,pageSize};
}
module.exports={courseRepCollections};
