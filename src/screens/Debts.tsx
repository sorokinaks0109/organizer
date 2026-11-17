// Долги и кредиты: остаток, платёж, график погашения; платёж можно вписать в предстоящие платежи.
import { useState } from 'react';
import { useStore } from '../lib/store';
import { useApp } from '../lib/context';
import { money, todayIso, ymShift, ymTitle } from '../lib/dates';
import { PAY, type PayKey } from '../lib/money';
import { deleteDebt, saveDebt, schedule, scheduleStart, setDebtAmount, type Debt } from '../lib/debts';
import { Hero, Sheet, useToast } from '../components/ui';

const monthYear = (ym: string) => ymTitle(ym).toLowerCase();

export function Debts() {
  const store = useStore();
  const { go } = useApp();
  const debts = store.settings.debts || [];
  const open = debts.filter((d) => !d.closed), closed = debts.filter((d) => d.closed);
  const [edit, setEdit] = useState<Debt | 'new' | null>(null);
  const [show, setShow] = useState<string | null>(null);
  const [amt, setAmt] = useState<{ d: Debt; ym: string; sum: string } | null>(null);
  const total = open.reduce((a, d) => a + d.balance, 0), monthly = open.reduce((a, d) => a + d.payment, 0);
  return (
    <>
      <Hero color="purple" title="Долги" onBack={() => go({ name: 'money' })}>
        <div className="big-num" style={{ color: 'var(--d-purple)' }}>{money(total)}</div>
        <span className="mini" style={{ color: 'var(--d-purple)' }}>осталось выплатить · {money(monthly)} в месяц</span>
      </Hero>
      {open.map((d) => {
        const start = scheduleStart(store, d), plan = schedule(d, start), last = plan[plan.length - 1];
        const stuck = d.payment > 0 && !plan.length && d.balance > 0;
        return (
          <div key={d.id} className="block">
            <div className="bh"><h4>{d.name}</h4><button type="button" onClick={() => setEdit(d)}>изменить</button></div>
            <div className="kv"><span>Остаток</span><b>{money(d.balance)}</b></div>
            <div className="kv"><span>Платёж</span><span style={{ textAlign: 'right' }}>{money(d.payment)} в месяц{d.rate ? `, ${d.rate}%` : ''}</span></div>
            <div className="kv"><span>Платить с</span><span>{PAY[d.key].name.toLowerCase()}</span></div>
            <div className="kv"><span>Первый платёж</span><span>{monthYear(start)}</span></div>
            <div className="kv"><span>Последний платёж</span><span>{stuck ? 'платёж не покрывает проценты' : last ? `${monthYear(last.ym)} · всего ${plan.length}` : '—'}</span></div>
            <span className="mini">{d.inPlan ? 'Вписан в предстоящие платежи: оплатишь в «Деньгах» — остаток уменьшится сам.' : 'Не вписан в платежи.'} Остаток на {d.balanceAt.split('-').reverse().join('.')}.</span>
            {plan.length > 0 && <button type="button" className="paidtoggle" aria-expanded={show === d.id} onClick={() => setShow(show === d.id ? null : d.id)}><span>График платежей</span><b>{show === d.id ? '▴' : '▾'}</b></button>}
            {show === d.id && (
              <div className="cats">
                {plan.map((r) => (
                  <button key={r.ym} type="button" className="kv mini" style={{ border: 0, background: 'none', width: '100%', padding: '4px 0', textAlign: 'left' }} onClick={() => setAmt({ d, ym: r.ym, sum: String(r.payment) })}>
                    <span>{ymTitle(r.ym)}{d.amounts?.[r.ym] !== undefined ? ' ✎' : ''}</span>
                    <span><u>{money(r.payment)}</u>{r.interest ? ` (проценты ${money(r.interest)})` : ''} → остаток {money(r.left)}</span>
                  </button>
                ))}
                <span className="mini">Нажми на сумму месяца, чтобы поменять платёж только в этом месяце.</span>
              </div>
            )}
          </div>
        );
      })}
      {!open.length && <div className="empty">Долгов нет. Добавь кредит, рассрочку или долг — посчитаю, когда он закончится, и впишу платёж в план.</div>}
      <button type="button" className="addbtn" onClick={() => setEdit('new')}>＋ Долг или кредит</button>
      {closed.length > 0 && <div className="block"><div className="bh"><h4>Закрытые</h4></div>{closed.map((d) => <button key={d.id} type="button" className="sprow" onClick={() => setEdit(d)}><span className="ic">✓</span><span>{d.name}<small>закрыт</small></span><span className="sm" /></button>)}</div>}
      {amt && (
        <Sheet open onClose={() => setAmt(null)}>
          <h3>Платёж: {monthYear(amt.ym)}</h3>
          <span className="mini">{amt.d.name}. Обычный платёж — {money(amt.d.payment)}.</span>
          <input className="field amount" inputMode="decimal" value={amt.sum} aria-label="Сумма" onChange={(e) => setAmt({ ...amt, sum: e.target.value })} />
          <div className="row">
            <button className="btn primary" type="button" onClick={async () => { await setDebtAmount(store, amt.d.id, amt.ym, Number(amt.sum.replace(/\s/g, '').replace(',', '.')) || 0); setAmt(null); }}>Сохранить</button>
            {amt.d.amounts?.[amt.ym] !== undefined && <button className="btn ghost" type="button" onClick={async () => { await setDebtAmount(store, amt.d.id, amt.ym, amt.d.payment); setAmt(null); }}>Вернуть обычный</button>}
          </div>
        </Sheet>
      )}
      {edit && <DebtSheet key={edit === 'new' ? 'new' : edit.id} debt={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function DebtSheet({ debt, onClose }: { debt: Debt | null; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const num = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.')) || 0;
  const [name, setName] = useState(debt?.name || '');
  const [balance, setBalance] = useState(debt ? String(debt.balance) : '');
  const [payment, setPayment] = useState(debt ? String(debt.payment) : '');
  const [rate, setRate] = useState(debt?.rate ? String(debt.rate) : '');
  const [key, setKey] = useState<PayKey>(debt?.key || 'zp');
  const [inPlan, setInPlan] = useState(debt?.inPlan ?? true);
  const [first, setFirst] = useState(debt?.firstYm || ymShift(todayIso().slice(0, 7), 1));
  const [busy, setBusy] = useState(false);
  const ok = name.trim() && num(balance) >= 0 && num(payment) > 0;
  const preview = ok ? schedule({ balance: num(balance), payment: num(payment), rate: num(rate) || null, amounts: debt?.amounts }, scheduleStart(store, { key, id: debt?.id || 'new', firstYm: first })) : [];
  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    const b = num(balance);
    await saveDebt(store, {
      id: debt?.id || crypto.randomUUID(), name: name.trim(), balance: b,
      balanceAt: debt && debt.balance === b ? debt.balanceAt : todayIso(),
      payment: num(payment), rate: num(rate) || null, key, inPlan, closed: b <= 0, firstYm: first, amounts: debt?.amounts,
    });
    toast(inPlan && b > 0 ? 'Сохранено, платёж вписан в план' : 'Сохранено');
    onClose();
  };
  return (
    <Sheet open onClose={onClose}>
      <h3>{debt ? debt.name : 'Новый долг'}</h3>
      <label className="lbl" style={{ flex: 'none' }}>Название<input className="field" value={name} placeholder="Кредитка Т-банк, рассрочка на ноутбук…" onChange={(e) => setName(e.target.value)} /></label>
      <div className="row">
        <label className="lbl">Остаток сейчас, ₽<input className="field" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} /></label>
        <label className="lbl">Платёж в месяц, ₽<input className="field" inputMode="decimal" value={payment} onChange={(e) => setPayment(e.target.value)} /></label>
      </div>
      <label className="lbl" style={{ flex: 'none' }}>Ставка, % годовых (если есть)<input className="field" inputMode="decimal" value={rate} placeholder="0 — без процентов" onChange={(e) => setRate(e.target.value)} /></label>
      <label className="lbl" style={{ flex: 'none' }}>Месяц первого платежа<input className="field" type="month" value={first} onChange={(e) => setFirst(e.target.value)} /></label>
      <span className="lbl-t">С какой выплаты платить</span>
      <div className="chips">{(['avans', 'zp'] as PayKey[]).map((k) => <button key={k} type="button" className="chip" aria-pressed={key === k} onClick={() => setKey(k)}>{PAY[k].name}</button>)}</div>
      <label className="toggle-row"><input type="checkbox" className="check" checked={inPlan} onChange={(e) => setInPlan(e.target.checked)} /><span>Вписать в предстоящие платежи<br /><small className="mini">появится в плане каждого месяца; оплатишь — остаток уменьшится сам</small></span></label>
      {preview.length > 0 && <span className="mini">Платежи с {monthYear(preview[0].ym)} по {monthYear(preview[preview.length - 1].ym)} · всего {preview.length}{num(rate) ? `, проценты всего ≈ ${money(preview.reduce((a, r) => a + r.interest, 0))}` : ''}</span>}
      {ok && !preview.length && num(balance) > 0 && <span className="err">Платёж не покрывает проценты — долг так не погасится.</span>}
      <span className="mini">Банк показывает другой остаток — просто впиши его сюда, график пересчитается.</span>
      <div className="row">
        <button className="btn primary" type="button" disabled={!ok || busy} onClick={save}>{busy ? 'Сохраняю…' : 'Сохранить'}</button>
        <span style={{ flex: 1 }} />
        {debt && <button className="btn ghost danger" type="button" onClick={async () => { await deleteDebt(store, debt); onClose(); }}>Удалить</button>}
      </div>
    </Sheet>
  );
}
