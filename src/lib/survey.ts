import { sql } from "drizzle-orm";
import { getDb } from "@/db";

export const SURVEY_LIKES = [
  "onboarding_process",
  "team_culture",
  "manager_support",
  "tools_and_access",
  "training_materials",
  "career_growth",
  "compensation_benefits",
] as const;
export type SurveyLike = (typeof SURVEY_LIKES)[number];
export const SURVEY_LIKE_LABEL: Record<SurveyLike, string> = {
  onboarding_process: "Onboarding process",
  team_culture: "Team culture",
  manager_support: "Manager support",
  tools_and_access: "Tools & access",
  training_materials: "Training materials",
  career_growth: "Career growth opportunities",
  compensation_benefits: "Compensation & benefits",
};

export const SURVEY_IMPROVEMENTS = [
  "clearer_expectations",
  "more_training",
  "faster_equipment_access",
  "better_communication",
  "more_social_integration",
  "more_feedback",
  "career_path_clarity",
  "compensation_benefits",
] as const;
export type SurveyImprovement = (typeof SURVEY_IMPROVEMENTS)[number];
export const SURVEY_IMPROVEMENT_LABEL: Record<SurveyImprovement, string> = {
  clearer_expectations: "Clearer expectations",
  more_training: "More training",
  faster_equipment_access: "Faster equipment / access setup",
  better_communication: "Better communication",
  more_social_integration: "More social integration",
  more_feedback: "More regular feedback",
  career_path_clarity: "Career path clarity",
  compensation_benefits: "Compensation & benefits",
};

export type SurveySegmentRow = {
  segment: string;
  responses: number;
  avgOnboarding: number | null;
  avgManagerSupport: number | null;
  avgOverall: number | null;
};

/** Average scores grouped by a given employees column (business_unit or career_track), for responded six-month surveys. */
async function segmentBy(column: "business_unit" | "career_track"): Promise<SurveySegmentRow[]> {
  const db = getDb();
  const rows = await db.execute<{ segment: string | null; responses: number; avg_onb: number | null; avg_mgr: number | null; avg_overall: number | null }>(
    sql.raw(`
      select
        coalesce(e.${column}, '(none)') as segment,
        count(*)::int as responses,
        avg(s.onboarding_experience_score)::float as avg_onb,
        avg(s.manager_support_score)::float as avg_mgr,
        avg(s.overall_satisfaction_score)::float as avg_overall
      from onboarding_surveys s
      join employees e on e.id = s.employee_id
      where s.survey_type = 'six_month' and s.responded_at is not null
      group by coalesce(e.${column}, '(none)')
      order by responses desc
    `),
  );
  return rows.rows.map((r) => ({
    segment: r.segment ?? "(none)",
    responses: r.responses,
    avgOnboarding: r.avg_onb,
    avgManagerSupport: r.avg_mgr,
    avgOverall: r.avg_overall,
  }));
}

export type OptionFrequency = { option: string; count: number };

async function optionFrequency(column: "likes" | "improvements"): Promise<OptionFrequency[]> {
  const db = getDb();
  const rows = await db.execute<{ option: string; count: number }>(
    sql.raw(`
      select unnest(${column}) as option, count(*)::int as count
      from onboarding_surveys
      where survey_type = 'six_month' and responded_at is not null
      group by option
      order by count desc
    `),
  );
  return rows.rows;
}

/** Full segmented report for the dashboard: overall + by business unit + by career track, plus like/improvement frequencies. */
export async function surveyReport() {
  const [byBusinessUnit, byCareerTrack, likeFrequency, improvementFrequency, overall] = await Promise.all([
    segmentBy("business_unit"),
    segmentBy("career_track"),
    optionFrequency("likes"),
    optionFrequency("improvements"),
    segmentByOverall(),
  ]);
  return { overall, byBusinessUnit, byCareerTrack, likeFrequency, improvementFrequency };
}

async function segmentByOverall(): Promise<SurveySegmentRow> {
  const db = getDb();
  const rows = await db.execute<{ responses: number; avg_onb: number | null; avg_mgr: number | null; avg_overall: number | null }>(
    sql`
      select
        count(*)::int as responses,
        avg(onboarding_experience_score)::float as avg_onb,
        avg(manager_support_score)::float as avg_mgr,
        avg(overall_satisfaction_score)::float as avg_overall
      from onboarding_surveys
      where survey_type = 'six_month' and responded_at is not null
    `,
  );
  const r = rows.rows[0];
  return { segment: "All responses", responses: r?.responses ?? 0, avgOnboarding: r?.avg_onb ?? null, avgManagerSupport: r?.avg_mgr ?? null, avgOverall: r?.avg_overall ?? null };
}
