import { describe, expect, it } from 'vitest';
import { attendanceText, trainMark } from '../src/lib/train';
import type { CalEvent } from '../src/lib/gcal';

const ev = (id: string, day: string, title: string): CalEvent => ({ id, day, time: '13:00', endTime: '15:00', title, calendarId: 'p', family: false, link: '', start: '', end: '', allDay: false, attendees: [], fromOrganizer: false, recurring: true });

describe('посещения', () => {
  it('текст для преподавателя', () => {
    const list = [ev('a', '2026-10-25', 'Балет: тренировка №1 из 12'), ev('b', '2026-10-26', 'Балет: тренировка отменена'), ev('c', '2026-10-29', 'Балет: тренировка №2 из 12'), ev('d', '2026-11-01', 'Балет: тренировка №3 из 12')];
    const marks: Record<string, 'went' | 'excused' | 'missed'> = { a: 'went', c: 'excused' };
    const text = attendanceText(list, (e) => marks[e.id] ?? null, [{ id: 'p', date: '2026-10-24', sum: 9600, note: '12 занятий' }], 'Балет');
    expect(text).toContain('Абонемент оплачен 24 октября, 9');
    expect(text).toContain('25.10 вс 13:00 (№1) — была');
    expect(text).toContain('26.10 пн 13:00 — отменено');
    expect(text).toContain('по уважительной');
    expect(text).toContain('Итого: была 1, по уважительной 1, отменено 1, не отмечено 1.');
  });
  it('старая отметка из event_links читается', () => {
    expect(trainMark({ settings: {}, event_links: [{ event_id: 'x', area_id: null, project_id: null, mark: 'went' }] } as never, 'x')).toBe('went');
    expect(trainMark({ settings: { trainMarks: { x: 'excused' } }, event_links: [] } as never, 'x')).toBe('excused');
  });
});
