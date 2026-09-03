import { useEffect, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Select from '../components/ui/Select';
import Pagination from '../components/ui/Pagination';

export default function Payments() {
  const { user } = useAuth();
  const isSchool = user?.role === 'school_admin';
  const [payments, setPayments] = useState([]);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  useEffect(() => {
    const params = {};
    if (filter) params.type = filter;
    api.get('/payments', { params })
      .then((res) => setPayments(res.data))
      .catch(() => {});
  }, [filter]);

  useEffect(() => { setPage(1); }, [filter]);

  const filterOptions = isSchool
    ? [
        { value: '', label: 'All Payments' },
        { value: 'school_dues', label: 'School Dues Only' },
        { value: 'department_dues', label: 'Department Dues Only' },
      ]
    : [
        { value: '', label: 'All Payments' },
        { value: 'department_dues', label: 'Department Dues Only' },
      ];

  return (
    <div>
      <div className="flex between align-center mb-md">
        <div>
          <h1>Payments</h1>
          <p className="subtitle">
            {isSchool
              ? 'View all recorded payments — school dues and department dues across all departments.'
              : 'View department dues payments recorded for your department.'}
          </p>
        </div>
        <div style={{ width: 220 }}>
          <Select value={filter} onChange={setFilter} options={filterOptions} placeholder="Filter..." />
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Receipt Number</th>
                <th>Student</th>
                {isSchool && <th>Department</th>}
                <th>Type</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Date</th>
                <th>Recorded By</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && <tr><td colSpan={isSchool ? 8 : 7} className="muted">{isSchool ? 'No payments recorded yet.' : 'No payments recorded for your department yet.'}</td></tr>}
              {payments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((p) => (
                <tr key={p.id}>
                  <td><span className="code-cell">{p.receipt_number}</span></td>
                  <td>{p.student_name}</td>
                  {isSchool && <td>{p.department_name || <span className="muted">—</span>}</td>}
                  <td>
                    <span className={`badge ${p.type === 'school_dues' ? 'badge-navy' : 'badge-green'}`}>
                      {p.type === 'school_dues' ? 'School Dues' : 'Dept Dues'}
                    </span>
                  </td>
                  <td>GHS {Number(p.amount).toFixed(2)}</td>
                  <td style={{ textTransform: 'capitalize' }}>{p.method === 'momo' ? 'Mobile Money' : p.method}</td>
                  <td>{new Date(p.paid_at).toLocaleDateString()}</td>
                  <td>
                    <span className="badge badge-gray">
                      {p.admin_role === 'SCHOOL_ADMIN' ? 'School Admin' : p.admin_role === 'DEPT_ADMIN' ? 'Dept Admin' : p.record_type}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          totalPages={Math.ceil(payments.length / PAGE_SIZE)}
          onPageChange={setPage}
          totalItems={payments.length}
          pageSize={PAGE_SIZE}
        />
      </div>
    </div>
  );
}
