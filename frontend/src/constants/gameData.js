export const EXTRAS = [
  { key: 'btts', cat: 'goals', en: 'Both teams to score?', ar: 'هل يسجل الفريقان؟', options: ['YES', 'NO'] },
  { key: 'ou_1_5', cat: 'goals', en: 'Over or under 1.5 goals?', ar: 'أكثر أم أقل من 1.5 هدف؟', options: ['OVER', 'UNDER'] },
  { key: 'ou_2_5', cat: 'goals', en: 'Over or under 2.5 goals?', ar: 'أكثر أم أقل من 2.5 هدف؟', options: ['OVER', 'UNDER'] },
  { key: 'ou_3_5', cat: 'goals', en: 'Over or under 3.5 goals?', ar: 'أكثر أم أقل من 3.5 هدف؟', options: ['OVER', 'UNDER'] },
  { key: 'goals_odd_even', cat: 'goals', en: 'Total goals odd or even?', ar: 'مجموع الأهداف فردي أم زوجي؟', options: ['ODD', 'EVEN'] },
  { key: 'ht_leader', cat: 'halves', en: 'Who leads at half-time?', ar: 'من يتقدم في الشوط الأول؟', options: ['HOME', 'DRAW', 'AWAY'] },
  { key: 'goal_both_halves', cat: 'halves', en: 'A goal in both halves?', ar: 'هدف في كلا الشوطين؟', options: ['YES', 'NO'] },
  { key: 'more_goals_half', cat: 'halves', en: 'Which half has more goals?', ar: 'أي شوط فيه أهداف أكثر؟', options: ['FIRST', 'EQUAL', 'SECOND'] },
  {
    key: 'clean_sheet',
    cat: 'result',
    en: 'Clean sheet',
    ar: 'الشباك النظيفة',
    options: ['HOME', 'AWAY', 'BOTH', 'NONE'],
    labels: {
      en: { HOME: 'Home only', AWAY: 'Away only', BOTH: 'Both (0-0)', NONE: 'None' },
      ar: { HOME: 'المضيف فقط', AWAY: 'الضيف فقط', BOTH: 'الاثنان (0-0)', NONE: 'لا أحد' }
    }
  },
  { key: 'win_by_2plus', cat: 'result', en: 'Win by 2+ goals?', ar: 'فوز بفارق هدفين أو أكثر؟', options: ['YES', 'NO'] }
];

export const CATEGORIES = ['goals', 'halves', 'result'];

export const OPTION_LABELS = {
  en: {
    YES: 'Yes', NO: 'No', OVER: 'Over', UNDER: 'Under', ODD: 'Odd', EVEN: 'Even',
    HOME: 'Home', DRAW: 'Draw', AWAY: 'Away', FIRST: '1st half', SECOND: '2nd half', EQUAL: 'Equal',
    BOTH: 'Both', NONE: 'None'
  },
  ar: {
    YES: 'نعم', NO: 'لا', OVER: 'أكثر', UNDER: 'أقل', ODD: 'فردي', EVEN: 'زوجي',
    HOME: 'المضيف', DRAW: 'تعادل', AWAY: 'الضيف', FIRST: 'الأول', SECOND: 'الثاني', EQUAL: 'متساوي',
    BOTH: 'الاثنان', NONE: 'لا أحد'
  }
};
