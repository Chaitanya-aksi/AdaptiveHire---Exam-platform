/**
 * Starter sheets handed to recruiters via
 * GET /api/questions/bulk-import/template/{mcq,personality}.
 *
 * Column names are matched case-insensitively with spaces normalised to
 * underscores, so "Question Text" also works.
 */

/**
 * `probe_group` is optional and twins two rows in the same module: the engine
 * serves one, waits out eight questions, then serves the other and compares.
 *
 * The two rows below share `seq-doubling`. They test the same rule with a
 * different sequence, different numbers and different distractors — which is the
 * bar to clear. A twin that merely reshuffles the same options gets recognised,
 * and a recognised twin measures nothing but the candidate's memory.
 */
export const MCQ_TEMPLATE_CSV = `module_slug,question_text,option_a,option_b,option_c,option_d,correct_option,difficulty_score,probe_group,tags
aptitude,"What is 15% of 240?",30,36,40,45,B,900,,percentages
logical-reasoning,"Which number continues the sequence: 2, 6, 12, 20, ?",28,30,32,36,B,1000,seq-doubling,sequences
logical-reasoning,"A pattern runs 3, 8, 15, 24. What comes next?",33,35,37,40,B,1000,seq-doubling,sequences
`;

/**
 * One row per behavioural pattern, since each takes a different option count:
 * situational and ranking use three to six, forced-choice and trade-off
 * exactly two (leave the later option columns empty).
 *
 * No option is the "right" one anywhere here — that is the whole point. Weights
 * run -3..+3 against the traits the Personality module declares, and
 * `option_x_behavior` is an optional label that shows up in the recruiter's
 * evidence view.
 *
 * Omitting `pattern` marks the row as a legacy agree/disagree item, which the
 * engine serves only rarely. New content should always set one.
 *
 * `probe_group` twins two rows that measure the same thing. The last two rows
 * here share `pg-teammate-struggling`: the same question about helping someone
 * who is behind, but one frames it as a teammate missing a deadline and the
 * other as a new joiner floundering, and no option text is reused. Writing the
 * twin as a genuinely different scenario is the whole job — if the candidate
 * spots the repeat they will just answer it the same way, and the pair will
 * confirm nothing.
 *
 * The twin does not have to use the same pattern. Asking the same thing as a
 * situational choice and then as a trade-off is a stronger check than asking it
 * twice the same way.
 */
export const PERSONALITY_TEMPLATE_CSV = `module_slug,question_text,pattern,option_a,option_a_weights,option_a_behavior,option_b,option_b_weights,option_b_behavior,option_c,option_c_weights,option_c_behavior,option_d,option_d_weights,option_d_behavior,probe_group,tags
personality,"Which describes you better?",forced_choice,"I enjoy leading discussions.","leadership:2;communication:2",Directing,"I enjoy analysing technical problems deeply.","ownership:2;adaptability:1",Analysing,,,,,,,,self-concept
personality,"Which would you prefer?",trade_off,"Deliver quickly, accepting minor mistakes.","risk_tolerance:2;adaptability:1;accountability:-1",Speed,"Take extra time to get everything right.","accountability:2;ownership:2;risk_tolerance:-2",Thoroughness,,,,,,,,speed-vs-quality
personality,"Rank these from most like you to least like you.",ranking,"Planning the work out in advance","accountability:2;ownership:2",Planning,"Taking the lead on it","leadership:3;communication:1",Leadership,"Trying an approach nobody has tried","adaptability:3;risk_tolerance:2",Creativity,"Backing a decision before all the data is in","risk_tolerance:3;leadership:1",Risk-taking,,priorities
personality,"Your teammate is struggling to finish an important task before the deadline. What would you most likely do?",situational,"Help them complete the task.","teamwork:3;empathy:3;leadership:1;accountability:1",Supportive,"Inform your manager immediately.","accountability:2;leadership:2;teamwork:-2;empathy:-3",Escalating,"Carry on with your own work.","leadership:-3;teamwork:-2;empathy:-2;accountability:-2",Disengaged,"Coach them so they can finish it themselves.","leadership:3;teamwork:3;empathy:2;accountability:3",Coaching,pg-teammate-struggling,deadline-pressure
personality,"A new joiner on your team keeps getting stuck and their first delivery is due on Friday. What do you do?",situational,"Sit with them and work through what is blocking them.","leadership:3;teamwork:3;empathy:2;accountability:3",Coaching,"Take the remaining items onto your own plate.","teamwork:3;empathy:3;leadership:1;accountability:1",Supportive,"Flag to your lead that the date is at risk.","accountability:2;leadership:2;teamwork:-2;empathy:-3",Escalating,"Leave them to it — they need to find their feet.","leadership:-3;teamwork:-2;empathy:-2;accountability:-2",Disengaged,pg-teammate-struggling,onboarding
`;
