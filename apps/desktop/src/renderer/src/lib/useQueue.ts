import { useCallback, useEffect, useRef, useState } from 'react';
import { forgetPdfBytes } from './files';
import { supabase } from './supabase';
import { JOB_COLUMNS, type Job } from './types';

export type Connection = 'connecting' | 'live' | 'offline';

/** Backup in case a Realtime message is ever missed. Realtime is the main path. */
const POLL_MS = 30_000;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * The shop's live queue: everything submitted and not yet collected, plus what
 * was collected today. Refreshes on every change to the shop's jobs (Realtime),
 * on reconnect, and every 30 s as a backup.
 */
export function useQueue(shopId: string, onNewJob: (job: Job) => void) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');

  // jobs that have already been announced (or were already there at startup)
  const seen = useRef<Set<string> | null>(null);
  const onNewJobRef = useRef(onNewJob);
  onNewJobRef.current = onNewJob;
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    // one request at a time; a burst of changes becomes at most one extra fetch
    if (inflight.current) {
      again.current = true;
      return inflight.current;
    }
    inflight.current = (async () => {
      do {
        again.current = false;
        const { data, error: err } = await supabase
          .from('jobs')
          .select(JOB_COLUMNS)
          .eq('shop_id', shopId)
          .or(`status.in.(building,new,opened,printing,ready,failed),and(status.eq.done,done_at.gte.${startOfToday()})`)
          .order('submitted_at', { ascending: true })
          .returns<Job[]>();
        if (err) {
          setError(err.message);
          continue;
        }
        setError(null);
        const list = (data ?? []).map((j) => ({
          ...j,
          job_files: [...j.job_files].sort((a, b) => a.position - b.position),
        }));

        const fresh = list.filter((j) => j.status === 'new');
        if (seen.current === null) {
          // don't ring for what was already waiting; orders still being built ring once they're ready
          seen.current = new Set(list.filter((j) => j.status !== 'building').map((j) => j.id));
        } else {
          for (const j of fresh) {
            if (!seen.current.has(j.id)) {
              seen.current.add(j.id);
              onNewJobRef.current(j);
            }
          }
          for (const j of list) if (j.status !== 'building') seen.current.add(j.id);
        }

        setJobs(list);
        setLoaded(true);
        window.prints.queueChanged(fresh.length);
        forgetPdfBytes(new Set(list.filter((j) => j.status !== 'done').flatMap((j) => j.job_files.flatMap((f) => f.print_parts.map((p) => p.path)))));
      } while (again.current);
    })().finally(() => {
      inflight.current = null;
    });
    return inflight.current;
  }, [shopId]);

  useEffect(() => {
    void refresh();
    const channel = supabase
      .channel(`shop-jobs-${shopId}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: `shop_id=eq.${shopId}` }, () => {
        void refresh();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnection('live');
          void refresh(); // catch up on anything missed while disconnected
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnection('offline');
        }
      });

    const poll = window.setInterval(() => void refresh(), POLL_MS);
    const online = () => void refresh();
    window.addEventListener('online', online);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('online', online);
      void supabase.removeChannel(channel);
    };
  }, [shopId, refresh]);

  return { jobs, loaded, error, connection, refresh };
}

