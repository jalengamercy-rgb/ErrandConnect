'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { DocumentPreview } from '@/components/document-preview';
import { Badge, Button, Card, ErrorBox, KeyValue, Loading, PageHeader, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, fullName, humanize } from '@/lib/format';
import { useAction } from '@/lib/hooks';

interface Runner {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  status: string;
  dateOfBirth: string | null;
  gender: string | null;
  nationality: string | null;
  createdAt: string;
  runnerProfile: Record<string, unknown> & {
    runnerCode: string;
    applicationStatus: string;
    rejectionReason: string | null;
    nationalIdNumber: string | null;
    kraPin: string | null;
    county: string | null;
    city: string | null;
    area: string | null;
    preferredAreas: string[];
    deliveryTypes: string[];
    servicesOffered: string[];
    availability: string | null;
    workingDays: string[];
    workStartTime: string | null;
    workEndTime: string | null;
    maxDistanceKm: number | null;
    hasCriminalRecord: boolean | null;
    canLiftHeavy: boolean | null;
    willingToHandleCash: boolean | null;
    equipment: string[];
    languages: string[];
    skills: string[];
    vehicles: {
      id: string;
      type: string;
      make: string;
      model: string;
      color: string;
      registrationNumber: string;
      year: number;
      licenceNumber: string;
      licenceExpiry: string;
      insuranceNumber: string;
      insuranceExpiry: string;
      status: string;
    }[];
  };
  documents: { id: string; type: string; mimeType: string; status: string; rejectionReason: string | null; createdAt: string }[];
  payoutMethods: {
    type: string;
    accountName: string;
    phone: string | null;
    bankName: string | null;
    accountNumber: string | null;
    status: string;
  }[];
  emergencyContacts: { fullName: string; relationship: string; phone: string }[];
  progress: { percentComplete: number; missingRequired: string[]; tracker: { key: string; label: string; done: boolean }[] };
}

const CHECKS: { key: 'IDENTITY' | 'VEHICLE' | 'BACKGROUND' | 'PAYOUT'; tracker: string; label: string }[] = [
  { key: 'IDENTITY', tracker: 'identity', label: 'Identity verified' },
  { key: 'VEHICLE', tracker: 'vehicle', label: 'Vehicle verified' },
  { key: 'BACKGROUND', tracker: 'background', label: 'Background check' },
  { key: 'PAYOUT', tracker: 'payout', label: 'Payout account' },
];

const yesNo = (v: boolean | null) => (v === null ? '—' : v ? 'Yes' : 'No');

export default function RunnerPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const key = ['/admin/runners', id];
  const { data: r, error } = useQuery({ queryKey: key, queryFn: () => api.get<Runner>(`/admin/runners/${id}`) });
  const [reason, setReason] = useState('');

  const refresh = [key, ['/admin/runners']];
  const startReview = useAction(() => api.post(`/admin/runners/${id}/start-review`), refresh);
  const check = useAction((body: { check: string; passed: boolean }) => api.post(`/admin/runners/${id}/checks`, body), refresh);
  const reviewDoc = useAction(
    (body: { docId: string; decision: 'APPROVED' | 'REJECTED'; reason?: string }) =>
      api.post(`/admin/documents/${body.docId}/review`, { decision: body.decision, reason: body.reason }),
    refresh,
  );
  const approve = useAction(() => api.post(`/admin/runners/${id}/approve`), refresh);
  const reject = useAction(() => api.post(`/admin/runners/${id}/reject`, { reason }), refresh);
  const suspend = useAction(() => api.post(`/admin/users/${id}/suspend`, { reason }), refresh);
  const activate = useAction(() => api.post(`/admin/users/${id}/activate`), refresh);

  if (error) return <ErrorBox error={error} />;
  if (!r) return <Loading />;
  const p = r.runnerProfile;
  const status = p.applicationStatus;
  const actionError =
    startReview.error ?? check.error ?? reviewDoc.error ?? approve.error ?? reject.error ?? suspend.error ?? activate.error;
  const done = (tracker: string) => r.progress.tracker.find((t) => t.key === tracker)?.done;
  const hasVehicle = r.progress.tracker.some((t) => t.key === 'vehicle');
  // Newest upload of each document type.
  const latestDocs = r.documents.filter((d, i) => r.documents.findIndex((x) => x.type === d.type) === i);

  return (
    <>
      <PageHeader
        title={fullName(r)}
        subtitle={`${p.runnerCode} · ${r.phone} · joined ${date(r.createdAt)}`}
        actions={
          <>
            <Badge status={status} />
            <Badge status={r.status} />
          </>
        }
      />
      <ErrorBox error={actionError} />
      {p.rejectionReason && <p className="mb-4 text-sm text-danger">Last rejection: {p.rejectionReason}</p>}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Review">
            <div className="mb-3 text-sm text-muted">
              Profile {r.progress.percentComplete}% complete
              {r.progress.missingRequired.length ? ` · missing: ${r.progress.missingRequired.join(', ')}` : ''}
            </div>
            <ul className="mb-4 space-y-1 text-sm">
              {r.progress.tracker.map((t) => (
                <li key={t.key}>
                  {t.done ? '🟢' : '🟡'} {t.label}
                </li>
              ))}
            </ul>
            {status === 'SUBMITTED' && (
              <Button onClick={() => startReview.mutate()} loading={startReview.isPending}>
                Start review
              </Button>
            )}
            {(status === 'UNDER_REVIEW' || status === 'APPROVED') && (
              <div className="flex flex-wrap gap-2">
                {CHECKS.filter((c) => c.key !== 'VEHICLE' || hasVehicle).map((c) => (
                  <Button
                    key={c.key}
                    variant={done(c.tracker) ? 'secondary' : 'primary'}
                    loading={check.isPending && check.variables?.check === c.key}
                    onClick={() => check.mutate({ check: c.key, passed: !done(c.tracker) })}
                  >
                    {done(c.tracker) ? `Undo: ${c.label}` : `Mark: ${c.label}`}
                  </Button>
                ))}
              </div>
            )}
            {status === 'UNDER_REVIEW' && (
              <div className="mt-4 flex flex-wrap items-start gap-2 border-t border-border pt-4">
                <Button onClick={() => approve.mutate()} loading={approve.isPending}>
                  Approve runner
                </Button>
              </div>
            )}
            {(status === 'SUBMITTED' || status === 'UNDER_REVIEW' || can('OPERATIONS_MANAGER')) && (
              <div className="mt-4 space-y-2 border-t border-border pt-4">
                <Textarea
                  placeholder="Reason (shown to the runner when rejecting)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  {(status === 'SUBMITTED' || status === 'UNDER_REVIEW') && (
                    <Button variant="danger" disabled={reason.trim().length < 3} onClick={() => reject.mutate()} loading={reject.isPending}>
                      Reject application
                    </Button>
                  )}
                  {can('OPERATIONS_MANAGER') &&
                    (r.status === 'ACTIVE' ? (
                      <Button
                        variant="secondary"
                        disabled={reason.trim().length < 3}
                        onClick={() => suspend.mutate()}
                        loading={suspend.isPending}
                      >
                        Suspend account
                      </Button>
                    ) : (
                      <Button variant="secondary" onClick={() => activate.mutate()} loading={activate.isPending}>
                        Reactivate account
                      </Button>
                    ))}
                </div>
              </div>
            )}
          </Card>

          <Card title="Documents">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {latestDocs.map((d) => (
                <div key={d.id} className="space-y-2 rounded-lg border border-border p-2">
                  <div className="flex items-center justify-between gap-2 text-sm font-medium">
                    {humanize(d.type)} <Badge status={d.status} />
                  </div>
                  <DocumentPreview id={d.id} mimeType={d.mimeType} alt={humanize(d.type)} />
                  {d.rejectionReason && <div className="text-xs text-danger">{d.rejectionReason}</div>}
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      disabled={d.status === 'APPROVED'}
                      onClick={() => reviewDoc.mutate({ docId: d.id, decision: 'APPROVED' })}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={d.status === 'REJECTED'}
                      onClick={() => {
                        const why = window.prompt('Why is this document rejected? (shown to the runner)');
                        if (why && why.trim().length >= 3) reviewDoc.mutate({ docId: d.id, decision: 'REJECTED', reason: why.trim() });
                      }}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
              {latestDocs.length === 0 && <p className="text-sm text-muted">No documents uploaded yet.</p>}
            </div>
          </Card>

          {p.vehicles.length > 0 && (
            <Card title="Vehicles">
              {p.vehicles.map((v) => (
                <KeyValue
                  key={v.id}
                  items={[
                    ['Vehicle', `${humanize(v.type)} · ${v.make} ${v.model} (${v.color}, ${v.year})`],
                    ['Registration', v.registrationNumber],
                    ['Licence', `${v.licenceNumber} · expires ${date(v.licenceExpiry)}`],
                    ['Insurance', `${v.insuranceNumber} · expires ${date(v.insuranceExpiry)}`],
                    ['Status', <Badge key="s" status={v.status} />],
                  ]}
                />
              ))}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Personal">
            <KeyValue
              items={[
                ['Email', r.email],
                ['Date of birth', date(r.dateOfBirth)],
                ['Gender', humanize(r.gender)],
                ['Nationality', r.nationality],
                ['ID number', p.nationalIdNumber],
                ['KRA PIN', p.kraPin],
                ['Lives in', [p.area, p.city, p.county].filter(Boolean).join(', ')],
                ['Works in', p.preferredAreas.join(', ')],
              ]}
            />
          </Card>
          <Card title="Work">
            <KeyValue
              items={[
                ['Delivers by', p.deliveryTypes.map(humanize).join(', ')],
                ['Services', p.servicesOffered.map(humanize).join(', ')],
                ['Availability', humanize(p.availability)],
                ['Days', p.workingDays.join(', ')],
                ['Hours', p.workStartTime ? `${p.workStartTime}–${p.workEndTime}` : '—'],
                ['Max distance', p.maxDistanceKm ? `${p.maxDistanceKm} km` : 'No limit'],
                ['Languages', p.languages.map(humanize).join(', ')],
                ['Equipment', p.equipment.map(humanize).join(', ')],
              ]}
            />
          </Card>
          <Card title="Background">
            <KeyValue
              items={[
                ['Criminal record', yesNo(p.hasCriminalRecord)],
                ['Lifts heavy items', yesNo(p.canLiftHeavy)],
                ['Handles cash', yesNo(p.willingToHandleCash)],
              ]}
            />
          </Card>
          <Card title="Payout & emergency contact">
            <KeyValue
              items={[
                ...r.payoutMethods.map((m): [string, React.ReactNode] => [
                  humanize(m.type),
                  <span key={m.type}>
                    {m.accountName} · {m.phone ?? `${m.bankName} ${m.accountNumber}`} <Badge status={m.status} />
                  </span>,
                ]),
                ...r.emergencyContacts.map((c): [string, React.ReactNode] => ['Emergency', `${c.fullName} (${c.relationship}) ${c.phone}`]),
              ]}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
