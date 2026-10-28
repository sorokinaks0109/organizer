import { describe, expect, it } from 'vitest';
import { iso, money, parseIso, plural, ymShift, ymTitle } from '../src/lib/dates';
import { classify, seriesId, SUB_NUM } from '../src/lib/gcal';
import type { Area, EventLink, Project } from '../src/lib/types';

describe('даты и деньги', () => {
  it('переводит дату туда и обратно', () => { expect(iso(parseIso('2026-10-27'))).toBe('2026-10-27'); });
  it('листает месяцы через год', () => { expect(ymShift('2026-12', 1)).toBe('2027-01'); expect(ymShift('2026-01', -1)).toBe('2025-12'); });
  it('пишет название месяца', () => { expect(ymTitle('2026-10')).toBe('Октябрь 2026'); });
  it('склоняет слова', () => {
    expect(plural(1, 'дело', 'дела', 'дел')).toBe('дело');
    expect(plural(3, 'дело', 'дела', 'дел')).toBe('дела');
    expect(plural(11, 'дело', 'дела', 'дел')).toBe('дел');
    expect(plural(22, 'дело', 'дела', 'дел')).toBe('дела');
  });
  it('пишет сумму с ₽', () => { expect(money(64000).replace(/\s/g, ' ')).toBe('64 000 ₽'); });
});

describe('раскладка событий календаря', () => {
  const areas: Area[] = [
    { id: 'sport', name: 'Тренировки', color: 'red', keywords: ['балет'], sort: 0 },
    { id: 'study', name: 'Учёба', color: 'purple', keywords: ['аспирант'], sort: 1 },
  ];
  const projects: Project[] = [{ id: 'exam', area_id: 'study', name: 'Экзамен', goal: null, due_date: null, done: false, keywords: ['философ'], sort: 0 }];

  it('по словам сферы', () => { expect(classify({ id: 'a', title: 'Балет №3 из 16' }, [], areas, projects)).toEqual({ area: 'sport', project: null }); });
  it('по словам проекта раньше сферы', () => { expect(classify({ id: 'b', title: 'Аспирантура: философия' }, [], areas, projects)).toEqual({ area: 'study', project: 'exam' }); });
  it('ручная привязка серии подходит её занятиям', () => {
    const links: EventLink[] = [{ event_id: 'ser', area_id: 'study', project_id: null, mark: null }];
    expect(classify({ id: 'ser_20261027', title: 'Балет' }, links, areas, projects).area).toBe('study');
  });
  it('отметка без сферы не мешает словам', () => {
    const links: EventLink[] = [{ event_id: 'x', area_id: null, project_id: null, mark: 'went' }];
    expect(classify({ id: 'x', title: 'Балет' }, links, areas, projects).area).toBe('sport');
  });
  it('id серии', () => { expect(seriesId({ id: 'abc_20261027T150000Z', recurring: true })).toBe('abc'); expect(seriesId({ id: 'abc', recurring: false })).toBe('abc'); });
  it('номер абонемента', () => { expect('Балет №2 из 16'.match(SUB_NUM)?.slice(1)).toEqual(['2', '16']); });
});

import { phraseText } from '../src/lib/voice';
describe('склейка распознанной фразы', () => {
  it('берёт самую полную версию нарастающей фразы', () => {
    expect(phraseText(['написать', 'написать Анатолию', 'написать Анатолию по работе'])).toBe('написать Анатолию по работе');
  });
  it('не дублирует повтор', () => {
    expect(phraseText(['к пятнице отчёт', 'отчёт'])).toBe('к пятнице отчёт');
  });
  it('склеивает разные части', () => {
    expect(phraseText(['такси 342', ' и кофе'])).toBe('такси 342 и кофе');
  });
});

import { toPcm16 } from '../src/lib/voice';
describe('звук для SpeechKit', () => {
  it('переводит 48 кГц в 16 кГц, 16 бит', () => {
    const input = new Float32Array(4800).fill(0.5);
    const out = toPcm16(input, 48000);
    expect(out.length).toBe(1600);
    expect(out[0]).toBe(Math.floor(0.5 * 0x7fff));
  });
});

import { segment, trimSilence } from '../src/lib/voice';
describe('нарезка записи', () => {
  const P = (rms: number, len = 1600) => ({ len, rms });
  it('обрезает тишину по краям с запасом', () => {
    const ps = [...Array(20).fill(P(0)), ...Array(5).fill(P(0.1)), ...Array(20).fill(P(0))];
    const t = trimSilence(ps);
    expect(t.length).toBe(4 + 5 + 6);
  });
  it('режет длинную запись по самому тихому месту', () => {
    const ps = Array.from({ length: 300 }, (_, i) => P(i === 240 ? 0 : 0.1)); // 30 секунд по 0,1 с
    const parts = segment(ps);
    expect(parts.length).toBe(2);
    expect(parts[0].length).toBe(241);
    expect(parts.flat().length).toBe(300);
  });
});

import { normDate } from '../src/lib/actions';
describe('даты от нейросети', () => {
  it('понимает разные записи', () => {
    expect(normDate('2027-7-2')).toBe('2027-07-02');
    expect(normDate('02.07.2027')).toBe('2027-07-02');
    expect(normDate('2.7', '2026-10-28')).toBe('2027-07-02');
    expect(normDate('25.12', '2026-10-28')).toBe('2026-12-25');
    expect(normDate('завтра')).toBe(null);
  });
});
