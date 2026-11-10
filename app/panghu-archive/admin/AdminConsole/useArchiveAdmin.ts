import { useCallback, useEffect, useRef, useState } from "react";
import {
  AdminApiError,
  createSession,
  deleteSession,
  EMPTY_FILTERS,
  readRecords,
  readSession,
  type ArchiveFilters,
  type ArchiveRecord,
} from "./api";

type SessionState = "checking" | "anonymous" | "authenticated" | "error";
type Action = "session" | "login" | "records" | "logout" | null;

export function useArchiveAdmin() {
  const [session, setSession] = useState<SessionState>("checking");
  const [sessionRefresh, setSessionRefresh] = useState(0);
  const [busy, setBusy] = useState<Action>("session");
  const [error, setError] = useState("");
  const [records, setRecords] = useState<ArchiveRecord[]>([]);
  const [filters, setFilters] = useState<ArchiveFilters>(EMPTY_FILTERS);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<Action>(null);

  const begin = useCallback((action: Action) => {
    controller.current?.abort();
    const request = ++sequence.current;
    const abort = new AbortController();
    controller.current = abort;
    pending.current = action;
    return {
      signal: abort.signal,
      current: () =>
        mounted.current &&
        sequence.current === request &&
        !abort.signal.aborted,
    };
  }, []);

  const finish = useCallback(() => {
    pending.current = null;
    setBusy(null);
  }, []);

  const clearRecords = useCallback(() => {
    setRecords([]);
    setCursors([null]);
    setNextCursor(null);
    setLoaded(false);
  }, []);

  const load = useCallback(
    async (query: ArchiveFilters, history: (string | null)[]) => {
      const request = begin("records");
      setBusy("records");
      setError("");
      setRecords([]);
      setNextCursor(null);
      setLoaded(false);
      setCursors(history);
      try {
        const result = await readRecords(
          query,
          history[history.length - 1],
          request.signal,
        );
        if (!request.current()) return;
        setRecords(result.records);
        setNextCursor(result.nextCursor);
        setLoaded(true);
      } catch (cause) {
        if (!request.current()) return;
        if (cause instanceof AdminApiError && cause.status === 401) {
          setSession("anonymous");
          clearRecords();
          setError("登录已失效，请重新登录。");
        } else
          setError(
            cause instanceof Error ? cause.message : "记录加载失败，请重试。",
          );
      } finally {
        if (request.current()) finish();
      }
    },
    [begin, clearRecords, finish],
  );

  const abortPending = useCallback(() => {
    ++sequence.current;
    controller.current?.abort();
  }, []);

  useEffect(() => {
    mounted.current = true;
    const request = begin("session");
    void readSession(request.signal)
      .then(() => {
        if (!request.current()) return;
        setSession("authenticated");
        void load(EMPTY_FILTERS, [null]);
      })
      .catch((cause: unknown) => {
        if (!request.current()) return;
        if (cause instanceof AdminApiError && cause.status === 401)
          setSession("anonymous");
        else {
          setSession("error");
          setError(
            cause instanceof Error
              ? cause.message
              : "无法检查登录状态，请重试。",
          );
        }
      })
      .finally(() => {
        if (request.current()) finish();
      });
    return () => {
      mounted.current = false;
      abortPending();
    };
  }, [begin, finish, load, abortPending, sessionRefresh]);

  const login = async (password: string) => {
    if (pending.current) return;
    const request = begin("login");
    setBusy("login");
    setError("");
    try {
      await createSession(password, request.signal);
      if (!request.current()) return;
      setSession("authenticated");
      setFilters(EMPTY_FILTERS);
      void load(EMPTY_FILTERS, [null]);
    } catch (cause) {
      if (request.current())
        setError(cause instanceof Error ? cause.message : "登录失败，请重试。");
    } finally {
      if (request.current()) finish();
    }
  };

  const logout = async () => {
    if (pending.current === "logout") return;
    const request = begin("logout");
    setBusy("logout");
    setError("");
    clearRecords();
    try {
      await deleteSession(request.signal);
      if (request.current()) {
        setSession("anonymous");
        setFilters(EMPTY_FILTERS);
      }
    } catch (cause) {
      if (!request.current()) return;
      if (cause instanceof AdminApiError && cause.status === 401)
        setSession("anonymous");
      else
        setError(cause instanceof Error ? cause.message : "退出失败，请重试。");
    } finally {
      if (request.current()) finish();
    }
  };

  const changeFilters = (next: ArchiveFilters) => {
    controller.current?.abort();
    ++sequence.current;
    pending.current = null;
    setBusy(null);
    setError("");
    setFilters(next);
    clearRecords();
  };

  return {
    session,
    busy,
    error,
    records,
    filters,
    page: cursors.length,
    nextCursor,
    loaded,
    login,
    logout,
    changeFilters,
    retrySession: () => {
      setSession("checking");
      setBusy("session");
      setError("");
      setSessionRefresh((value) => value + 1);
    },
    applyFilters: () => {
      if (!pending.current) void load(filters, [null]);
    },
    retryRecords: () => {
      if (!pending.current) void load(filters, cursors);
    },
    next: () => {
      if (!pending.current && nextCursor !== null)
        void load(filters, [...cursors, nextCursor]);
    },
    previous: () => {
      if (!pending.current && cursors.length > 1)
        void load(filters, cursors.slice(0, -1));
    },
  };
}
