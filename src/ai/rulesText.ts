import rulesChapterText from 'virtual:readme-rules';
import { rulesSections } from './readmeSections';

/** The rules for AI helpers: chapter 11.5 of README.md, the one home (the build cuts it out of the README). */
export const RULES_TEXT: string = rulesChapterText;

/** Its "#### 11.5.n Heading" sections, by heading in lower case. */
export const RULES_PARTS: Record<string, string> = rulesSections(RULES_TEXT);
