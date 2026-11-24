import Pagination from './ui/Pagination';
export default function CourseRepCollections({data,onPageChange}) {
 const rows=data?.course_reps||[];
 const amount=value=>'GHS '+Number(value||0).toLocaleString('en-GH',{minimumFractionDigits:2,maximumFractionDigits:2});
 return <section className="card course-rep-collections" style={{marginTop:24}}>
  <div className="card-header"><h3>School dues collected by course reps</h3></div>
  <div className="table-wrap"><table className="table"><thead><tr><th>Course rep</th><th>Department</th><th>Amount collected</th></tr></thead>
   <tbody>{rows.length?rows.map(row=><tr key={row.collector_id+'-'+row.department_id}><td className="fw-600">{row.name}</td><td>{row.department}</td><td className="fw-600">{amount(row.amount)}</td></tr>):<tr><td colSpan={3} className="muted">No course reps match these filters.</td></tr>}</tbody>
   <tfoot><tr><td colSpan={2}>Total collected by course reps</td><td className="fw-600">{amount(data?.total_collected)}</td></tr></tfoot>
  </table></div>
  {Number(data?.unattributed_amount)>0&&<p className="muted">{amount(data.unattributed_amount)} has no reliable course-rep identifier and is shown separately in the table.</p>}
  {Number(data?.other_collections)>0&&<p className="muted">Other accounts recorded {amount(data.other_collections)} in continuing-student school dues. That amount is excluded from the course-rep total.</p>}
  <Pagination page={data?.page||1} totalPages={Math.max(1,Math.ceil((data?.total||0)/(data?.pageSize||10)))} onPageChange={onPageChange} totalItems={data?.total||0} pageSize={data?.pageSize||10}/>
 </section>;
}
