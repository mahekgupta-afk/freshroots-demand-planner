import { z } from "zod";

const band = z.object({ min: z.number().positive(), max: z.number().positive() })
  .refine((b) => b.min < b.max, "min must be below max");

export const rulesSchema = z.object({
  version: z.string().min(1),
  festival_months: z.array(z.number().int().min(1).max(12)),
  festival_uplift: z.number().min(1),
  high_demand: z.object({
    threshold_vs_12wk: z.number().min(1),
    reorder_multiplier: z.number().min(1),
  }),
  cover_weeks: z.object({ standard: band, perishable: band }),
  include_open_pos_in_stock: z.boolean(),
  review_triggers: z.object({
    min_weeks_history: z.number().int().min(1),
    max_coefficient_of_variation: z.number().positive(),
    last_week_drop_ratio: z.number().positive().max(1),
  }),
});

export type Rules = z.infer<typeof rulesSchema>;
