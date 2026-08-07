"use client";

import { useMemo, useState } from "react";
import { decryptMessage, encryptMessage, generatePassword } from "./secret-crypto";
import styles from "./secret.module.css";

type Mode = "encrypt" | "decrypt";
type Notice = { type: "success" | "error"; message: string } | null;

function LockIcon({ open = false }: { open?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={open ? "M7 10V7a5 5 0 0 1 9.4-2.4" : "M7 10V7a5 5 0 0 1 10 0v3"} />
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M12 14v3" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
      {hidden ? <path d="m4 4 16 16" /> : null}
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14M14 7l5 5-5 5" />
    </svg>
  );
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export default function SecretWorkbench() {
  const [mode, setMode] = useState<Mode>("encrypt");
  const [plainText, setPlainText] = useState("");
  const [sealedText, setSealedText] = useState("");
  const [decryptInput, setDecryptInput] = useState("");
  const [decryptedText, setDecryptedText] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const input = mode === "encrypt" ? plainText : decryptInput;
  const output = mode === "encrypt" ? sealedText : decryptedText;
  const inputLength = Array.from(input).length;

  const passwordQuality = useMemo(() => {
    if (!password) return { label: "尚未设置", level: 0 };
    const variety = [/[a-z]/u, /[A-Z]/u, /\d/u, /[^A-Za-z0-9]/u].filter((rule) =>
      rule.test(password),
    ).length;
    const score = password.length + variety * 2;
    if (score < 14) return { label: "偏弱", level: 1 };
    if (score < 22) return { label: "可用", level: 2 };
    return { label: "较强", level: 3 };
  }, [password]);

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setNotice(null);

    if (nextMode === "decrypt" && !decryptInput && sealedText) {
      setDecryptInput(sealedText);
    }
  }

  async function handleTransform() {
    setNotice(null);

    if (!input.trim()) {
      setNotice({ type: "error", message: mode === "encrypt" ? "请先写下要加密的内容。" : "请先粘贴完整密文。" });
      return;
    }

    if (!password) {
      setNotice({ type: "error", message: "请先输入你和朋友约定的口令。" });
      return;
    }

    if (mode === "encrypt" && password.length < 8) {
      setNotice({ type: "error", message: "口令至少需要 8 位；更长、更随机会更安全。" });
      return;
    }

    setIsWorking(true);

    try {
      if (mode === "encrypt") {
        const result = await encryptMessage(plainText, password);
        setSealedText(result);
        setNotice({ type: "success", message: "封缄完成。复制密文发给朋友，口令请用另一条渠道告知。" });
      } else {
        const result = await decryptMessage(decryptInput, password);
        setDecryptedText(result);
        setNotice({ type: "success", message: "拆信成功，内容已在本机还原。" });
      }
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "操作失败，请稍后重试。",
      });
    } finally {
      setIsWorking(false);
    }
  }

  async function handleCopy(value: string, label: string) {
    if (!value) return;

    try {
      await copyText(value);
      setNotice({ type: "success", message: `${label}已复制到剪贴板。` });
    } catch {
      setNotice({ type: "error", message: "复制失败，请手动选择并复制。" });
    }
  }

  function handleGeneratePassword() {
    try {
      const nextPassword = generatePassword();
      setPassword(nextPassword);
      setShowPassword(true);
      setNotice({ type: "success", message: "已生成 24 位随机口令。请妥善保存，并与密文分开发送。" });
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "无法生成随机口令。",
      });
    }
  }

  function handleClear() {
    if (mode === "encrypt") {
      setPlainText("");
      setSealedText("");
    } else {
      setDecryptInput("");
      setDecryptedText("");
    }
    setNotice(null);
  }

  return (
    <div className={styles.workbench}>
      <div className={styles.modeSwitch} role="tablist" aria-label="选择加密或解密">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "encrypt"}
          className={mode === "encrypt" ? styles.activeMode : ""}
          onClick={() => switchMode("encrypt")}
        >
          <span>封缄</span>
          <small>加密中文</small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "decrypt"}
          className={mode === "decrypt" ? styles.activeMode : ""}
          onClick={() => switchMode("decrypt")}
        >
          <span>拆信</span>
          <small>解密中文</small>
        </button>
      </div>

      <div className={styles.paper}>
        <div className={styles.paperGrain} aria-hidden="true" />

        <section className={styles.textPanel} aria-labelledby="source-label">
          <div className={styles.fieldHeading}>
            <div>
              <span className={styles.step}>壹</span>
              <label id="source-label" htmlFor="secret-source">
                {mode === "encrypt" ? "写下原文" : "贴入密文"}
              </label>
            </div>
            <span>{inputLength.toLocaleString("zh-CN")} 字</span>
          </div>
          <textarea
            id="secret-source"
            value={input}
            onChange={(event) =>
              mode === "encrypt" ? setPlainText(event.target.value) : setDecryptInput(event.target.value)
            }
            placeholder={
              mode === "encrypt"
                ? "比如：周六下午三点，还是老地方见。"
                : "粘贴以“密笺·1·”开头的完整内容…"
            }
            spellCheck={false}
            autoCapitalize="off"
          />
          <button type="button" className={styles.clearButton} onClick={handleClear} disabled={!input && !output}>
            清空当前内容
          </button>
        </section>

        <section className={styles.controlPanel} aria-labelledby="password-label">
          <div className={styles.controlTopline}>
            <span className={styles.step}>贰</span>
            <span id="password-label">约定口令</span>
          </div>

          <div className={styles.passwordField}>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 8 位"
              aria-labelledby="password-label"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? "隐藏口令" : "显示口令"}
              title={showPassword ? "隐藏口令" : "显示口令"}
            >
              <EyeIcon hidden={!showPassword} />
            </button>
          </div>

          <div className={styles.passwordMeta}>
            <div className={styles.strength} data-level={passwordQuality.level}>
              <i />
              <i />
              <i />
            </div>
            <span>{passwordQuality.label}</span>
          </div>

          <div className={styles.passwordActions}>
            <button type="button" onClick={handleGeneratePassword}>
              生成强口令
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" onClick={() => handleCopy(password, "口令")} disabled={!password}>
              复制口令
            </button>
          </div>

          <button type="button" className={styles.sealButton} onClick={handleTransform} disabled={isWorking}>
            <span className={styles.sealIcon}>
              <LockIcon open={mode === "decrypt"} />
            </span>
            <span>
              <b>{isWorking ? "处理中…" : mode === "encrypt" ? "加密成密文" : "解密看原文"}</b>
              <small>{mode === "encrypt" ? "LOCAL ENCRYPT" : "LOCAL DECRYPT"}</small>
            </span>
            <ArrowIcon />
          </button>

          <p className={styles.localNote}>
            <span className={styles.pulse} />
            全程仅在此设备处理
          </p>
        </section>

        <section className={styles.textPanel} aria-labelledby="result-label">
          <div className={styles.fieldHeading}>
            <div>
              <span className={styles.step}>叁</span>
              <label id="result-label" htmlFor="secret-result">
                {mode === "encrypt" ? "取走密文" : "读出原文"}
              </label>
            </div>
            {output ? (
              <button type="button" className={styles.copyButton} onClick={() => handleCopy(output, mode === "encrypt" ? "密文" : "原文")}>
                <CopyIcon />
                复制
              </button>
            ) : null}
          </div>
          <textarea
            id="secret-result"
            className={output ? styles.hasResult : ""}
            value={output}
            placeholder={mode === "encrypt" ? "加密后的内容会出现在这里" : "正确原文会出现在这里"}
            readOnly
            spellCheck={false}
          />
          <p className={styles.resultHint}>
            {mode === "encrypt" ? "可通过微信、邮件等任意方式发送" : "看完后可点击左侧“清空当前内容”"}
          </p>
        </section>
      </div>

      <div className={styles.noticeArea} aria-live="polite" aria-atomic="true">
        {notice ? (
          <div className={`${styles.notice} ${notice.type === "error" ? styles.noticeError : styles.noticeSuccess}`}>
            <span>{notice.type === "error" ? "!" : "✓"}</span>
            {notice.message}
          </div>
        ) : (
          <p>忘记口令将无法恢复内容——这里没有账户，也没有后门。</p>
        )}
      </div>
    </div>
  );
}
