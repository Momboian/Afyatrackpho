// Team page for ward leads: workload per officer this week and healthcare facilities with overdue actions.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, humanize } from '../lib/format.js';
import { Badge, Card, PageHeader, Spinner, Button, Empty, ErrorNote } from '../components/ui.jsx';
import { useLoad, TaskForm } from '../components/forms.jsx';

// The Team page.
export default function Team() {
  const { can, me } = useAuth();
  const { data, loading, error, reload } = useLoad(() => api('/team'), [me.ward?.id]);
  const [assign, setAssign] = useState(null);
  // Only ward leads (and admins) can open this page.
  if (!can.lead) return <ErrorNote error="The team view is for the ward lead." />;
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  return (
    <div>
      <PageHeader title="Team" subtitle={`Ward task allocation and workload · week of ${fmtDate(data.week.start)}`}
        actions={<Button onClick={() => setAssign({})}><Plus className="h-4 w-4" />Assign task</Button>} />
      {/* One row per officer with their counts and an Assign button. */}
      <Card className="mb-5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Officer</th><th className="text-right">Open tasks</th><th className="text-right">Overdue</th><th className="text-right">Completed this week</th><th className="text-right">Activities this week</th><th className="text-right">Overdue follow ups</th><th></th></tr></thead>
            <tbody>
              {data.officers.map((o) => (
                <tr key={o.id}>
                  <td><div className="font-semibold">{o.full_name}</div><div className="text-[12px] text-ink-faint">{o.roles.split(',').map(humanize).join(', ')}</div></td>
                  <td className="text-right font-mono"><Link className="hover:underline" to={`/planner?status=open`}>{o.open_tasks}</Link></td>
                  <td className="text-right">{o.overdue_tasks ? <Badge tone="red">{o.overdue_tasks}</Badge> : <span className="font-mono text-ink-faint">0</span>}</td>
                  <td className="text-right font-mono">{o.completed_this_week}</td>
                  <td className="text-right font-mono">{o.activities_this_week}</td>
                  <td className="text-right">{o.overdue_follow_ups ? <Badge tone="amber">{o.overdue_follow_ups}</Badge> : <span className="font-mono text-ink-faint">0</span>}</td>
                  <td className="text-right">{!o.roles.includes('reviewer') || o.roles.includes('officer') ? <Button size="sm" variant="secondary" onClick={() => setAssign({ assigned_to: o.id })}>Assign</Button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {/* Healthcare facilities with overdue follow up actions. */}
      <Card>
        <div className="border-b border-line px-4 py-3 font-bold">Healthcare facilities with overdue sanitation actions</div>
        {data.facilitiesOverdue.length === 0 ? <Empty title="No overdue facility actions" /> : data.facilitiesOverdue.map((f) => (
          <div key={f.id} className="flex flex-col gap-1 border-b border-line/70 px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
            <div><Link to={`/registers/facility/${f.facility_id}`} className="font-semibold text-brand-700 hover:underline">{f.facility_name}</Link><div className="text-sm">{f.action_required}</div></div>
            <div className="text-[13px] text-ink-soft">Responsible: <b>{f.responsible_name}</b> · <span className="font-semibold text-red-600">due {fmtDate(f.due_date)}</span></div>
          </div>
        ))}
      </Card>
      {/* Pop up form to assign a new task, already set to the chosen officer. */}
      <TaskForm open={!!assign} onClose={() => setAssign(null)} onSaved={reload} preset={assign || {}} />
    </div>
  );
}
