'use client';

/**
 * @file packages/dashboard/src/app/tasks/page.tsx
 * @description Defines route-level UI composition and page behavior.
 */

import { useState, useEffect } from 'react';
import { gatewayFetch } from '@/lib/api';
import { Card, Button, Spinner, Badge, EmptyState, PageHeader } from '@/components/ui';
import { Clock, Plus, Trash2, Play, Pause, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';

interface CronJob {
  id: string;
  name: string;
  schedule: string;
  task: string;
  enabled: boolean;
  lastRun?: number;
  createdAt: number;
}

export default function TasksPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newSchedule, setNewSchedule] = useState('');
  const [newTask, setNewTask] = useState('');

  useEffect(() => {
    void loadJobs();
  }, []);

  const loadJobs = async () => {
    try {
      setLoading(true);
      const data = await gatewayFetch<{ jobs: CronJob[] }>('/api/cron');
      setJobs(data.jobs || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleJob = async (id: string, currentStatus: boolean) => {
    try {
      const res = await gatewayFetch<{ job: CronJob }>(`/api/cron/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !currentStatus }),
      });
      setJobs(jobs.map((j) => (j.id === id ? res.job : j)));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const deleteJob = async (id: string) => {
    if (!confirm('Are you sure you want to delete this task?')) return;
    try {
      await gatewayFetch(`/api/cron/${id}`, { method: 'DELETE' });
      setJobs(jobs.filter((j) => j.id !== id));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const createJob = async () => {
    if (!newName || !newSchedule || !newTask) return;
    try {
      const res = await gatewayFetch<{ job: CronJob }>('/api/cron', {
        method: 'POST',
        body: JSON.stringify({ name: newName, schedule: newSchedule, task: newTask }),
      });
      setJobs([...jobs, res.job]);
      setShowCreate(false);
      setNewName('');
      setNewSchedule('');
      setNewTask('');
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <PageHeader
        title="Scheduled Tasks"
        subtitle="Manage automated agent workflows and cron jobs."
      >
        <Button onClick={() => setShowCreate(!showCreate)} size="sm" variant="primary">
          <Plus className="w-4 h-4 mr-2" />
          New Task
        </Button>
      </PageHeader>

      <div className="px-8 py-6 space-y-6 overflow-y-auto">
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-4 rounded-lg flex items-center gap-3">
            <AlertTriangle className="w-5 h-5" />
            {error}
          </div>
        )}

        {showCreate && (
          <Card className="p-6 border-primary/20 bg-primary/5 mb-6">
            <h3 className="text-lg font-medium text-text-primary mb-4">Create New Task</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Name</label>
                <input
                  className="w-full bg-background/50 border border-border-primary/50 rounded px-3 py-2 text-sm text-text-primary focus:border-primary/50 outline-none"
                  placeholder="Daily News Check"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  Schedule (Cron)
                </label>
                <input
                  className="w-full bg-background/50 border border-border-primary/50 rounded px-3 py-2 text-sm text-text-primary focus:border-primary/50 outline-none font-mono"
                  placeholder="0 9 * * *"
                  value={newSchedule}
                  onChange={(e) => setNewSchedule(e.target.value)}
                />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-medium text-text-muted mb-1">Task Prompt</label>
              <textarea
                className="w-full bg-background/50 border border-border-primary/50 rounded px-3 py-2 text-sm text-text-primary focus:border-primary/50 outline-none h-24 resize-none"
                placeholder="Search for AI news and summarize..."
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={createJob}>
                Create Task
              </Button>
            </div>
          </Card>
        )}

        {jobs.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No scheduled tasks"
            description="Create a task to automate agent actions on a schedule."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {jobs.map((job) => (
              <Card
                key={job.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-start gap-4">
                  <div
                    className={clsx(
                      'p-3 rounded-lg border',
                      job.enabled
                        ? 'bg-green-500/10 border-green-500/20 text-green-500'
                        : 'bg-text-muted/10 border-text-muted/20 text-text-muted',
                    )}
                  >
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-text-primary">{job.name}</h3>
                      {!job.enabled && <Badge variant="default">Paused</Badge>}
                    </div>
                    <code className="text-xs text-primary font-mono mt-1 block">
                      {job.schedule}
                    </code>
                    <p className="text-sm text-text-muted mt-2 whitespace-pre-wrap">{job.task}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleJob(job.id, job.enabled)}
                    title={job.enabled ? 'Pause' : 'Resume'}
                  >
                    {job.enabled ? (
                      <Pause className="w-4 h-4 text-text-muted" />
                    ) : (
                      <Play className="w-4 h-4 text-primary" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="hover:text-red-500 hover:bg-red-500/10"
                    onClick={() => deleteJob(job.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
