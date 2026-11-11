import type { PresentedReport } from "../present";
import styles from "../style.module.css";

function Chevron({ up = false }: { up?: boolean }) {
  return <span className={`${styles.chevron} ${up ? styles.chevronUp : ""}`} />;
}

export function Receipt({
  report, sharedView, showInput, loading, saving, onToggleInput, onToggleIncome, onToggleExpense, onToggleWarnings, onToggleDay,
}: {
  report: PresentedReport;
  sharedView: boolean;
  showInput: boolean;
  loading: boolean;
  saving: boolean;
  onToggleInput: () => void;
  onToggleIncome: () => void;
  onToggleExpense: () => void;
  onToggleWarnings: () => void;
  onToggleDay: (index: number) => void;
}) {
  const warnings = [...report.reviewWarnings, ...report.infoWarnings];
  const profitClass = report.profitSize === "small" ? styles.profitSmall : report.profitSize === "medium" ? styles.profitMedium : "";
  return (
    <article className={`${styles.receipt} ${report.compactAmounts ? styles.compactAmounts : ""}`}>
      <header className={styles.receiptHeader}>
        <div className={styles.masthead}>
          <h2 className={styles.receiptTitle}>花店月结单</h2>
          <div className={styles.receiptMonth}><span className={styles.number}>{report.month}</span><span className={styles.monthUnit}>月</span></div>
        </div>
        <div className={styles.ticketTools}>
          <div><span className={styles.recordYear}>{report.year !== null ? `${report.year} / ` : ""}</span><span className={styles.number}>{report.dateRange}</span></div>
          {sharedView ? null : <button type="button" className={`${styles.textButton} ${styles.sourceToggle}`} onClick={onToggleInput} disabled={loading || saving}>[ {showInput ? "收起原文" : "查看原文"} ]</button>}
        </div>
      </header>
      <div className={styles.perforation} />
      <section className={styles.overview} aria-label="本月汇总">
        <div className={styles.profitLabel}>本 月 利 润</div>
        <div className={`${styles.profitValue} ${profitClass}`}><span className={styles.currency}>¥</span><span className={styles.number}>{report.displayTotals.profit}</span></div>
        <div className={styles.profitCaption}>收入 − 支出 / 人民币</div>
        <div className={styles.summary}>
          <button type="button" className={`${styles.textButton} ${styles.summaryToggle}`} onClick={onToggleIncome} aria-label={report.incomeExpanded ? "收起收入明细" : "展开收入明细"}>
            <span className={styles.summaryLabel}><span>收入合计</span><Chevron up={report.incomeExpanded} /></span>
            <span className={`${styles.summaryAmount} ${styles.number}`}>{report.displayTotals.income}</span>
          </button>
          {report.incomeExpanded ? (
            <div className={`${styles.summaryBreakdown} ${styles.incomeBreakdown}`}>
              <div className={styles.breakdownHead}><span>单价 × 销量</span><span>收入 / 元</span></div>
              {report.breakdown.income.map((price) => <div className={styles.salesRow} key={price.key}><span className={styles.salesDescription}>{price.description}</span><span className={`${styles.number} ${styles.salesAmount}`}>{price.displayAmount}</span></div>)}
              {report.breakdown.hasUnclassifiedIncome ? <div className={styles.salesRow}><span className={styles.unclassifiedLabel}>未提供销售明细的收入</span><span className={`${styles.number} ${styles.salesAmount}`}>{report.breakdown.unclassifiedIncomeDisplay}</span></div> : null}
              {!report.breakdown.income.length && !report.breakdown.hasUnclassifiedIncome ? <div className={styles.emptyNote}>本月收入 0.00 元</div> : null}
            </div>
          ) : null}
          <button type="button" className={`${styles.textButton} ${styles.summaryToggle}`} onClick={onToggleExpense} aria-label={report.expenseExpanded ? "收起支出明细" : "展开支出明细"}>
            <span className={styles.summaryLabel}><span>支出合计</span><Chevron up={report.expenseExpanded} /></span>
            <span className={`${styles.summaryAmount} ${styles.number}`}>{report.displayTotals.expense}</span>
          </button>
          {report.expenseExpanded ? (
            <div className={styles.summaryBreakdown}>
              {report.breakdown.expenses.map((expense) => (
                <div className={styles.expenseRow} key={expense.key}><span className={styles.expenseName}>{expense.label}</span><span className={styles.expenseLeader} /><span className={`${styles.number} ${styles.expenseAmount}`}>{expense.displayAmount}</span></div>
              ))}
              {!report.breakdown.expenses.length ? <div className={styles.emptyNote}>本月支出 0.00 元</div> : null}
              {report.hasIncludedExpenses ? <div className={styles.includedNote}>已包含费用仅在每日明细中说明，不重复入账。</div> : null}
            </div>
          ) : null}
        </div>
        <div className={styles.summaryMeta}><span>记账 <span className={styles.number}>{report.days}</span> 天</span><span>收入价位 <span className={styles.number}>{report.breakdown.income.length}</span> 档</span></div>
      </section>
      {report.warningCount ? (
        <>
          <div className={styles.perforation} />
          <section className={styles.notes} aria-label="核对备注">
            <div className={styles.sectionHeading}><span className={styles.sectionTitle}>核对备注</span><span className={styles.sectionCaption}>{report.warningCount} 项处理说明</span></div>
            <div className={styles.notesList}>
              {warnings.filter((item) => report.warningsExpanded || item.isPreviewVisible).map((item) => (
                <div className={`${styles.note} ${item.severity === "review" ? styles.noteReview : ""}`} key={item.key}>
                  <span className={`${styles.noteDate} ${item.compactDate ? styles.noteDateCompact : ""}`} aria-label={item.date || "说明"}>{item.dateLabel}</span>
                  <div className={styles.noteBody}>
                    {item.severity === "review" ? (
                      <div className={styles.noteHeading}><span className={styles.noteTitle}>{item.title}</span><span className={styles.priorityIcon} aria-label="需优先核对">!</span></div>
                    ) : <div className={styles.noteTitle}>{item.title}</div>}
                    <div className={styles.noteMessage}>{item.displayMessage}</div>
                  </div>
                </div>
              ))}
            </div>
            {report.warningCount > 2 ? (
              <button type="button" className={`${styles.textButton} ${styles.warningsToggle}`} onClick={onToggleWarnings} aria-label={report.warningsExpanded ? "收起核对备注" : "展开其余核对备注"}>
                <span>{report.warningsExpanded ? "收起备注" : `展开其余 ${report.warningCount - 2} 条`}</span><Chevron up={report.warningsExpanded} />
              </button>
            ) : null}
          </section>
        </>
      ) : null}
      <div className={styles.perforation} />
      <section className={styles.dailySection} aria-label="每日收支">
        <div className={styles.sectionHeading}><span className={styles.sectionTitle}>每日收支</span><span className={styles.sectionCaption}>{report.days} 天记录</span></div>
        <div className={`${styles.dailyGrid} ${styles.dailyHead}`}><span>日期</span><span>收入</span><span>支出</span><span>利润</span></div>
        <div className={styles.dailyScroll} style={{ maxHeight: report.dailyViewportHeight }} aria-label="每日收支，可上下滚动查看全部记录">
          {report.rows.map((row, rowIndex) => (
            <div className={styles.day} key={row.day}>
              <div className={`${styles.dailyGrid} ${styles.dailyValues}`}><span>{row.day}日</span><span className={styles.number}>{row.incomeDisplay}</span><span className={styles.number}>{row.expenseDisplay}</span><span className={styles.number}>{row.profitDisplay}</span></div>
              <button type="button" className={`${styles.textButton} ${styles.dayToggle}`} onClick={() => onToggleDay(rowIndex)} aria-label={`${row.day}日${row.expanded ? "收起明细" : "展开明细"}`}>
                <span>{row.expanded ? "收起明细" : "展开明细"}</span><Chevron up={row.expanded} />
              </button>
              {row.expanded ? (
                <div className={styles.dayDetails}>
                  {row.details.map((detail) => (
                    <div className={`${styles.detail} ${detail.included ? styles.includedDetail : ""}`} key={detail.key}>
                      <div className={styles.detailLine}><div className={styles.detailTitle}>{detail.categoryLabel} · {detail.label}{detail.included ? <span className={styles.includedLabel}>已包含</span> : null}</div><span className={`${styles.number} ${styles.detailAmount}`}>{detail.displayAmount}</span></div>
                      {detail.salesDescription ? <div className={styles.detailSales}>{detail.salesDescription}</div> : null}
                      {detail.accountingNote !== null ? <div className={styles.accountingNote}>{detail.accountingNote}</div> : null}
                      <span className={styles.evidence}>{detail.source}</span>
                    </div>
                  ))}
                  {row.commissionCheck ? <div className={styles.commissionCheck}>{row.commissionCheck.message}</div> : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {report.days > 5 ? <div className={styles.scrollHint}>上下滑动查看全部记录 <span aria-hidden="true">↕</span></div> : null}
      </section>
      <footer className={styles.receiptFooter}><div className={styles.footerMeta}>{report.title}账目 · 已统计 {report.days} 天</div><div className={styles.barcode} aria-hidden="true" /><div className={styles.footerType}>MONTHLY ACCOUNT</div></footer>
    </article>
  );
}
