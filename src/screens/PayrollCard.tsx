// Настройки зарплаты: из чего считаются аванс, расчёт за месяц и отпускные. Цифры — из расчётного листка.
import { useState } from 'react';
import { useStore } from '../lib/store';
import { absDate, money, todayIso } from '../lib/dates';
import { periodOf, nextPeriod } from '../lib/money';
import { payoutFor } from '../lib/moneyActions';
import { DEFAULT_PAYROLL, payrollReady, vacationPayments, type Payroll, type Vacation } from '../lib/payroll';
import { useToast } from '../components/ui';

export function PayrollCard() {
  const store = useStore();
  const toast = useToast();
  const [p, setP] = useState<Payroll>(() => ({ ...DEFAULT_PAYROLL, ...store.settings.payroll, vacations: [...(store.settings.payroll?.vacations || [])] }));
  const num = (k: keyof Payroll) => (
    <input className="field" type="number" inputMode="decimal" value={(p[k] as number) || ''} onChange={(e) => setP({ ...p, [k]: Number(e.target.value.replace(',', '.')) || 0 })} />
  );
  const setVac = (i: number, patch: Partial<Vacation>) => setP({ ...p, vacations: p.vacations.map((v, j) => (j === i ? { ...v, ...patch } : v)) });
  const save = async () => {
    const vacations = p.vacations.filter((v) => v.start && v.end && v.end >= v.start).sort((a, b) => a.start.localeCompare(b.start));
    await store.saveSettings({ payroll: { ...p, vacations } });
    toast('Сохранено — суммы выплат пересчитаны');
  };
  const saved = store.settings.payroll;
  const now = periodOf(todayIso());
  const preview = payrollReady(saved) ? [now, nextPeriod(now), nextPeriod(nextPeriod(now))].map((q) => ({ q, po: payoutFor(store, q) })) : [];
  const vacPays = saved ? vacationPayments(saved).filter((v) => v.date >= todayIso()) : [];
  return (
    <div className="card">
      <div className="card-t">Зарплата и отпуска</div>
      <span className="mini">По этим цифрам приложение само считает аванс, зарплату и отпускные — как в расчётном листке. Сумму, которая пришла на самом деле, отмечаешь в «Деньгах», и следующая выплата пересчитывается от неё.</span>
      <div className="row">
        <label className="lbl">Оклад, ₽{num('oklad')}</label>
        <label className="lbl">Районный + северная, %{num('northPct')}</label>
      </div>
      <div className="row">
        <label className="lbl">НПО в месяц, ₽{num('npo')}</label>
        <label className="lbl">НДФЛ, %{num('ndflPct')}</label>
      </div>
      <div className="row">
        <label className="lbl">Часов в пн–чт{num('hoursMonThu')}</label>
        <label className="lbl">Часов в пт{num('hoursFri')}</label>
      </div>
      <label className="lbl" style={{ flex: 'none' }}>Средний дневной заработок для отпускных, ₽
        {num('avgDaily')}
        <span className="mini">Из последнего листка с отпуском: сумма «Отпуск основной» ÷ число дней.</span>
      </label>
      <span className="lbl-t">Отпуска</span>
      {p.vacations.map((v, i) => (
        <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
          <input className="field" type="date" aria-label="Начало отпуска" value={v.start} onChange={(e) => setVac(i, { start: e.target.value })} />
          <span className="mini">—</span>
          <input className="field" type="date" aria-label="Конец отпуска" value={v.end} onChange={(e) => setVac(i, { end: e.target.value })} />
          <button className="x" type="button" aria-label="Убрать отпуск" onClick={() => setP({ ...p, vacations: p.vacations.filter((_, j) => j !== i) })}>×</button>
        </div>
      ))}
      <button className="btn ghost" type="button" style={{ alignSelf: 'flex-start', paddingInline: 0 }} onClick={() => setP({ ...p, vacations: [...p.vacations, { start: '', end: '' }] })}>+ отпуск</button>
      <button className="btn primary" type="button" onClick={save}>Сохранить</button>
      {preview.length > 0 && (
        <div className="card" style={{ background: 'var(--field)', gap: 4, padding: 12 }}>
          <span className="lbl-t">Ближайшие выплаты</span>
          {preview.map(({ q, po }) => <div key={q.ym + q.key} className="kv mini"><span>{q.key === 'avans' ? 'Аванс' : 'Зарплата'} · {absDate(po.date)}{po.source === 'actual' ? ' · пришло' : po.source === 'fixed' ? ' · введено' : ''}</span><b>{money(po.amount)}</b></div>)}
          {vacPays.map((v) => <div key={v.date} className="kv mini"><span>Отпускные · {absDate(v.date)}</span><b>{money(v.amount)}</b></div>)}
        </div>
      )}
    </div>
  );
}
