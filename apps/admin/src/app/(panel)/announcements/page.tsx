'use client';

import { useState } from 'react';
import { Button, Card, ErrorBox, Field, Input, Notice, PageHeader, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';

const AUDIENCES = [
  { value: 'ALL', label: 'Everyone' },
  { value: 'CUSTOMERS', label: 'All customers' },
  { value: 'RUNNERS', label: 'All approved runners' },
  { value: 'ONLINE_RUNNERS', label: 'Runners online now' },
];

export default function AnnouncementsPage() {
  const [audience, setAudience] = useState('ALL');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sms, setSms] = useState(false);
  const send = useAction(() => api.post<{ recipients: number }>('/admin/notifications', { audience, title, body, sms }));

  return (
    <>
      <PageHeader title="Announcements" subtitle="Appears in users' in-app inbox, and optionally by SMS" />
      <Card>
        <div className="max-w-xl space-y-3">
          <Field label="Send to">
            <Select value={audience} onChange={(e) => setAudience(e.target.value)} options={AUDIENCES} />
          </Field>
          <Field label="Title">
            <Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Message" hint={`${body.length}/500`}>
            <Textarea rows={4} value={body} maxLength={500} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sms} onChange={(e) => setSms(e.target.checked)} /> Also send by SMS (costs money per message
            once SMS is connected)
          </label>
          <ErrorBox error={send.error} />
          {send.data && <Notice>Sent to {send.data.recipients} people.</Notice>}
          <Button
            disabled={title.trim().length < 2 || body.trim().length < 2}
            loading={send.isPending}
            onClick={() => {
              if (window.confirm(`Send "${title}" to ${AUDIENCES.find((a) => a.value === audience)?.label.toLowerCase()}?`)) send.mutate();
            }}
          >
            Send announcement
          </Button>
        </div>
      </Card>
    </>
  );
}
