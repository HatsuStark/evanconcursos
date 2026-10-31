import { describe, expect, it } from 'vitest';
import { studyStreak, weekDays, weeklyGoals, type DayActivity, type GoalTask } from './goals.ts';

// 2026-10-28 é uma quarta-feira; a semana vai de 26/10 a 01/11.
const TODAY = '2026-10-28';
const EVERY_DAY = [2, 2, 2, 2, 2, 2, 2], NO_SUNDAY = [2, 2, 2, 2, 2, 2, 0];
const act = (day: string, over: Partial<DayActivity> = {}): DayActivity => ({ day, seconds: 0, questions: 1, tasks_done: 0, discursives: 0, ...over });
const task = (date: string, over: Partial<GoalTask> = {}): GoalTask => ({ date, minutes: 60, kind: 'theory', goal_questions: 10, ...over });

describe('weeklyGoals', () => {
  it('a meta soma as tarefas de segunda a domingo, sem a prova', () => {
    const g = weeklyGoals([task('2026-10-25'), task('2026-10-26'), task('2026-11-01'), task('2026-11-02'), task('2026-10-30', { kind: 'exam' })], [], TODAY);
    expect(g).toMatchObject({ start: '2026-10-26', end: '2026-11-01', minutes: { goal: 120 }, questions: { goal: 20 }, tasks: { goal: 2 } });
  });
  it('conta o feito na semana, com tarefa adiantada ou atrasada, e ignora outras semanas', () => {
    const g = weeklyGoals([], [act('2026-10-25', { seconds: 9999, questions: 9, tasks_done: 9 }), act('2026-10-26', { seconds: 600, questions: 3, tasks_done: 1 }), act('2026-10-28', { seconds: 130, questions: 2, tasks_done: 2 })], TODAY);
    expect(g).toMatchObject({ minutes: { done: 12 }, questions: { done: 5 }, tasks: { done: 3 } });
  });
  it('domingo pertence à semana que começou na segunda anterior', () => {
    expect(weeklyGoals([], [], '2026-11-01').start).toBe('2026-10-26');
  });
});

describe('studyStreak', () => {
  it('conta os dias seguidos até hoje', () => {
    expect(studyStreak([act('2026-10-28'), act('2026-10-27'), act('2026-10-26'), act('2026-10-24')], EVERY_DAY, TODAY)).toBe(3);
  });
  it('hoje ainda sem estudo não quebra a sequência', () => {
    expect(studyStreak([act('2026-10-27'), act('2026-10-26')], EVERY_DAY, TODAY)).toBe(2);
  });
  it('dia de estudo sem atividade quebra', () => {
    expect(studyStreak([act('2026-10-26')], EVERY_DAY, TODAY)).toBe(0);
  });
  it('folga prevista não quebra nem soma; estudar na folga soma', () => {
    const before = [act('2026-10-26'), act('2026-10-24')];
    expect(studyStreak(before, NO_SUNDAY, '2026-10-26')).toBe(2);
    expect(studyStreak([...before, act('2026-10-25')], NO_SUNDAY, '2026-10-26')).toBe(3);
  });
  it('poucos segundos no cronômetro não contam; tarefa, questão ou discursiva contam', () => {
    const zero = { questions: 0 };
    expect(studyStreak([act(TODAY, { ...zero, seconds: 59 })], EVERY_DAY, TODAY)).toBe(0);
    expect(studyStreak([act(TODAY, { ...zero, seconds: 60 })], EVERY_DAY, TODAY)).toBe(1);
    expect(studyStreak([act(TODAY, { ...zero, tasks_done: 1 })], EVERY_DAY, TODAY)).toBe(1);
    expect(studyStreak([act(TODAY, { ...zero, discursives: 1 })], EVERY_DAY, TODAY)).toBe(1);
  });
  it('plano sem nenhuma hora não trava', () => {
    expect(studyStreak([], [0, 0, 0, 0, 0, 0, 0], TODAY)).toBe(0);
  });
});

describe('weekDays', () => {
  it('marca estudo, folga, hoje e dias futuros', () => {
    const days = weekDays([act('2026-10-26')], NO_SUNDAY, TODAY);
    expect(days.map((d) => d.day)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    expect(days[0]).toMatchObject({ active: true, isToday: false, future: false });
    expect(days[1]).toMatchObject({ active: false, future: false });
    expect(days[2]).toMatchObject({ isToday: true, future: false });
    expect(days[6]).toMatchObject({ rest: true, future: true });
  });
});
