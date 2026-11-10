import { useCallback, useEffect, useRef, useState } from "react";
import {
  AdminApiError,
  createSession,
  deleteSession,
  EMPTY_FILTERS,
  readAccounts,
  readRecords,
  readSession,
  writeAccountName,
  type ArchiveAccount,
  type ArchiveFilters,
  type ArchiveRecord,
} from "./api";

type SessionState = "checking" | "anonymous" | "authenticated" | "error";
type AuthAction = "session" | "login" | "logout" | null;
type Lane = "auth" | "accounts" | "records" | "rename";
type RequestSlot = { revision: number; controller: AbortController | null };

export function useArchiveAdmin() {
  const [session, setSession] = useState<SessionState>("checking");
  const [sessionRefresh, setSessionRefresh] = useState(0);
  const [authBusy, setAuthBusy] = useState<AuthAction>("session");
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState("");
  const [accounts, setAccounts] = useState<ArchiveAccount[]>([]);
  const [accountsCursor, setAccountsCursor] = useState<string | null>(null);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [records, setRecords] = useState<ArchiveRecord[]>([]);
  const [filters, setFilters] = useState<ArchiveFilters>(EMPTY_FILTERS);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const mounted = useRef(false);
  const requests = useRef<Record<Lane, RequestSlot>>({
    auth: { revision: 0, controller: null },
    accounts: { revision: 0, controller: null },
    records: { revision: 0, controller: null },
    rename: { revision: 0, controller: null },
  });
  const abort = useCallback((lane: Lane) => {
    const slot = requests.current[lane];
    ++slot.revision;
    slot.controller?.abort();
    slot.controller = null;
  }, []);
  const abortAll = useCallback(() => {
    for (const lane of ["auth", "accounts", "records", "rename"] as const)
      abort(lane);
  }, [abort]);
  const begin = useCallback(
    (lane: Lane) => {
      abort(lane);
      const slot = requests.current[lane];
      const revision = slot.revision;
      const controller = new AbortController();
      slot.controller = controller;
      return {
        signal: controller.signal,
        current: () =>
          mounted.current &&
          slot.revision === revision &&
          !controller.signal.aborted,
        finish: () => {
          if (slot.revision === revision) slot.controller = null;
        },
      };
    },
    [abort],
  );
  const clearRecords = useCallback(() => {
    setRecords([]);
    setCursors([null]);
    setNextCursor(null);
    setLoaded(false);
  }, []);
  const clearWorkspace = useCallback(() => {
    clearRecords();
    setAccounts([]);
    setAccountsCursor(null);
    setAccountsLoaded(false);
    setSelectedProfile(null);
    setFilters(EMPTY_FILTERS);
  }, [clearRecords]);
  const reportError = useCallback(
    (cause: unknown) => {
      if (cause instanceof AdminApiError && cause.status === 401) {
        abortAll();
        clearWorkspace();
        setAuthBusy(null);
        setLoadingAccounts(false);
        setLoadingRecords(false);
        setRenaming(false);
        setSession("anonymous");
        setError("登录已失效，请重新登录。");
      } else
        setError(cause instanceof Error ? cause.message : "请求失败，请重试。");
    },
    [abortAll, clearWorkspace],
  );

  const loadAccounts = useCallback(
    async (cursor: string | null) => {
      const request = begin("accounts");
      setLoadingAccounts(true);
      setError("");
      try {
        const result = await readAccounts(cursor, request.signal);
        if (!request.current()) return;
        setAccounts((current) =>
          cursor === null
            ? result.accounts
            : [
                ...current,
                ...result.accounts.filter(
                  (account) =>
                    !current.some((item) => item.profile === account.profile),
                ),
              ],
        );
        setAccountsCursor(result.nextCursor);
        setAccountsLoaded(true);
      } catch (cause) {
        if (request.current()) reportError(cause);
      } finally {
        if (request.current()) {
          request.finish();
          setLoadingAccounts(false);
        }
      }
    },
    [begin, reportError],
  );

  const loadRecords = useCallback(
    async (
      profile: string,
      query: ArchiveFilters,
      history: (string | null)[],
    ) => {
      const request = begin("records");
      setLoadingRecords(true);
      setError("");
      setRecords([]);
      setNextCursor(null);
      setLoaded(false);
      setCursors(history);
      try {
        const result = await readRecords(
          profile,
          query,
          history[history.length - 1],
          request.signal,
        );
        if (!request.current()) return;
        setRecords(result.records);
        setNextCursor(result.nextCursor);
        setLoaded(true);
      } catch (cause) {
        if (request.current()) reportError(cause);
      } finally {
        if (request.current()) {
          request.finish();
          setLoadingRecords(false);
        }
      }
    },
    [begin, reportError],
  );

  useEffect(() => {
    mounted.current = true;
    const request = begin("auth");
    void readSession(request.signal)
      .then(() => {
        if (!request.current()) return;
        setSession("authenticated");
        void loadAccounts(null);
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
        if (request.current()) {
          request.finish();
          setAuthBusy(null);
        }
      });
    return () => {
      mounted.current = false;
      abortAll();
    };
  }, [begin, loadAccounts, abortAll, sessionRefresh]);

  const login = async (password: string) => {
    if (requests.current.auth.controller) return;
    const request = begin("auth");
    setAuthBusy("login");
    setError("");
    try {
      await createSession(password, request.signal);
      if (!request.current()) return;
      clearWorkspace();
      setSession("authenticated");
      void loadAccounts(null);
    } catch (cause) {
      if (request.current())
        setError(cause instanceof Error ? cause.message : "登录失败，请重试。");
    } finally {
      if (request.current()) {
        request.finish();
        setAuthBusy(null);
      }
    }
  };
  const logout = async () => {
    if (authBusy === "logout") return;
    abortAll();
    clearWorkspace();
    setLoadingAccounts(false);
    setLoadingRecords(false);
    setRenaming(false);
    const request = begin("auth");
    setAuthBusy("logout");
    setError("");
    try {
      await deleteSession(request.signal);
      if (request.current()) setSession("anonymous");
    } catch (cause) {
      if (request.current()) reportError(cause);
    } finally {
      if (request.current()) {
        request.finish();
        setAuthBusy(null);
      }
    }
  };
  const selectAccount = (profile: string) => {
    if (authBusy || !accounts.some((account) => account.profile === profile))
      return;
    abort("rename");
    setRenaming(false);
    clearRecords();
    setSelectedProfile(profile);
    setFilters(EMPTY_FILTERS);
    void loadRecords(profile, EMPTY_FILTERS, [null]);
  };
  const changeFilters = (next: ArchiveFilters) => {
    abort("records");
    setLoadingRecords(false);
    setError("");
    setFilters(next);
    clearRecords();
  };
  const saveName = async (profile: string, text: string) => {
    if (
      authBusy ||
      requests.current.rename.controller ||
      profile !== selectedProfile
    )
      return false;
    const request = begin("rename");
    setRenaming(true);
    setError("");
    try {
      const result = await writeAccountName(
        profile,
        text.trim() || null,
        request.signal,
      );
      if (!request.current()) return false;
      setAccounts((current) =>
        current.map((account) =>
          account.profile === result.profile
            ? { ...account, displayName: result.displayName }
            : account,
        ),
      );
      return true;
    } catch (cause) {
      if (request.current()) reportError(cause);
      return false;
    } finally {
      if (request.current()) {
        request.finish();
        setRenaming(false);
      }
    }
  };
  const busy = authBusy ?? (renaming ? "rename" : null);
  return {
    session,
    busy,
    error,
    accounts,
    accountsCursor,
    accountsLoaded,
    loadingAccounts,
    loadingRecords,
    selected:
      accounts.find((account) => account.profile === selectedProfile) ?? null,
    records,
    filters,
    page: cursors.length,
    nextCursor,
    loaded,
    login,
    logout,
    selectAccount,
    changeFilters,
    saveName,
    retrySession: () => {
      setSession("checking");
      setAuthBusy("session");
      setError("");
      setSessionRefresh((value) => value + 1);
    },
    refreshAccounts: () => {
      if (authBusy || requests.current.accounts.controller) return;
      abort("records");
      abort("rename");
      setLoadingRecords(false);
      setRenaming(false);
      clearWorkspace();
      void loadAccounts(null);
    },
    moreAccounts: () => {
      if (
        !authBusy &&
        !requests.current.accounts.controller &&
        accountsCursor !== null
      )
        void loadAccounts(accountsCursor);
    },
    applyFilters: () => {
      if (!busy && !requests.current.records.controller && selectedProfile)
        void loadRecords(selectedProfile, filters, [null]);
    },
    retryRecords: () => {
      if (!busy && !requests.current.records.controller && selectedProfile)
        void loadRecords(selectedProfile, filters, cursors);
    },
    next: () => {
      if (
        !busy &&
        !requests.current.records.controller &&
        selectedProfile &&
        nextCursor !== null
      )
        void loadRecords(selectedProfile, filters, [...cursors, nextCursor]);
    },
    previous: () => {
      if (
        !busy &&
        !requests.current.records.controller &&
        selectedProfile &&
        cursors.length > 1
      )
        void loadRecords(selectedProfile, filters, cursors.slice(0, -1));
    },
  };
}
