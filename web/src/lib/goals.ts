// Metas semanais e constância: atividade por dia vinda do banco (a conta fica em shared/domain/goals.ts).
import { useQuery } from '@tanstack/react-query';
import { activityStart, type DayActivity } from '../../../shared/domain/goals.ts';
import { today } from './plans.ts';
import { supabase } from './supabase.ts';

export const useStudyActivity = (planId: string | undefined) => useQuery({
  queryKey: ['study-activity', planId],
  enabled: !!planId,
  queryFn: async () => {
    const { data, error } = await supabase.rpc('study_activity', { p_plan: planId!, p_from: activityStart(today()) });
    if (error) throw new Error(error.message);
    return data as DayActivity[];
  },
});
