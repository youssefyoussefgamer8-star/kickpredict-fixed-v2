import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';

const LEAGUE_LOGOS = {
  PL: 'https://static.flashscore.com/res/image/data/rN76jpW1-naArgzhi.png',
  PD: 'https://static.flashscore.com/res/image/data/QqMkp58j-reLEIqyt.png',
  BL1: 'https://static.flashscore.com/res/image/data/OK1u7OEO-f1Humc6M.png',
  SA: 'https://static.flashscore.com/res/image/data/MR5bDSiU-IJ2iYpX2.png',
  FL1: 'https://static.flashscore.com/res/image/data/MsMVZaYI-MLhl2QvU.png',
  CL: 'https://static.flashscore.com/res/image/data/fLD8FzTp-jVJ5lAat.png',
  TUN: 'https://static.flashscore.com/res/image/data/YBrafEB7-j18GLkLE.png',
  TU1: 'https://static.flashscore.com/res/image/data/YBrafEB7-j18GLkLE.png'
};

// Realistic mock rosters for popular clubs
const KNOWN_ROSTERS = {
  'Arsenal': {
    formation: '4-3-3',
    manager: 'Mikel Arteta',
    starting: [
      { num: 22, name: 'Raya', pos: 'GK' },
      { num: 4, name: 'White', pos: 'DF' },
      { num: 2, name: 'Saliba', pos: 'DF' },
      { num: 6, name: 'Gabriel', pos: 'DF' },
      { num: 12, name: 'Timber', pos: 'DF' },
      { num: 5, name: 'Partey', pos: 'MF' },
      { num: 41, name: 'Rice', pos: 'MF' },
      { num: 8, name: 'Ødegaard', pos: 'MF' },
      { num: 7, name: 'Saka', pos: 'FW' },
      { num: 29, name: 'Havertz', pos: 'FW' },
      { num: 11, name: 'Martinelli', pos: 'FW' }
    ],
    subs: [
      { num: 32, name: 'Neto', pos: 'GK' },
      { num: 15, name: 'Kiwior', pos: 'DF' },
      { num: 17, name: 'Zinchenko', pos: 'DF' },
      { num: 20, name: 'Jorginho', pos: 'MF' },
      { num: 23, name: 'Merino', pos: 'MF' },
      { num: 19, name: 'Trossard', pos: 'FW' },
      { num: 9, name: 'Jesus', pos: 'FW' },
      { num: 30, name: 'Sterling', pos: 'FW' }
    ]
  },
  'Chelsea': {
    formation: '4-2-3-1',
    manager: 'Enzo Maresca',
    starting: [
      { num: 1, name: 'Sánchez', pos: 'GK' },
      { num: 27, name: 'Gusto', pos: 'DF' },
      { num: 29, name: 'Fofana', pos: 'DF' },
      { num: 6, name: 'Colwill', pos: 'DF' },
      { num: 3, name: 'Cucurella', pos: 'DF' },
      { num: 25, name: 'Caicedo', pos: 'MF' },
      { num: 45, name: 'Lavia', pos: 'MF' },
      { num: 11, name: 'Madueke', pos: 'MF' },
      { num: 20, name: 'Palmer', pos: 'MF' },
      { num: 19, name: 'Sancho', pos: 'MF' },
      { num: 15, name: 'Jackson', pos: 'FW' }
    ],
    subs: [
      { num: 12, name: 'Jörgensen', pos: 'GK' },
      { num: 4, name: 'Adarabioyo', pos: 'DF' },
      { num: 24, name: 'James', pos: 'DF' },
      { num: 8, name: 'Fernández', pos: 'MF' },
      { num: 22, name: 'Dewsbury-Hall', pos: 'MF' },
      { num: 18, name: 'Nkunku', pos: 'FW' },
      { num: 7, name: 'Neto', pos: 'FW' },
      { num: 14, name: 'Félix', pos: 'FW' }
    ]
  },
  'Liverpool': {
    formation: '4-2-3-1',
    manager: 'Arne Slot',
    starting: [
      { num: 1, name: 'Alisson', pos: 'GK' },
      { num: 66, name: 'Alexander-Arnold', pos: 'DF' },
      { num: 5, name: 'Konaté', pos: 'DF' },
      { num: 4, name: 'Van Dijk', pos: 'DF' },
      { num: 26, name: 'Robertson', pos: 'DF' },
      { num: 38, name: 'Gravenberch', pos: 'MF' },
      { num: 10, name: 'Mac Allister', pos: 'MF' },
      { num: 11, name: 'Salah', pos: 'MF' },
      { num: 8, name: 'Szoboszlai', pos: 'MF' },
      { num: 7, name: 'Díaz', pos: 'MF' },
      { num: 9, name: 'Núñez', pos: 'FW' }
    ],
    subs: [
      { num: 62, name: 'Kelleher', pos: 'GK' },
      { num: 2, name: 'Gomez', pos: 'DF' },
      { num: 21, name: 'Tsimikas', pos: 'DF' },
      { num: 3, name: 'Endo', pos: 'MF' },
      { num: 17, name: 'Jones', pos: 'MF' },
      { num: 19, name: 'Elliott', pos: 'MF' },
      { num: 18, name: 'Gakpo', pos: 'FW' },
      { num: 20, name: 'Jota', pos: 'FW' }
    ]
  },
  'Manchester City': {
    formation: '4-3-3',
    manager: 'Pep Guardiola',
    starting: [
      { num: 31, name: 'Ederson', pos: 'GK' },
      { num: 2, name: 'Walker', pos: 'DF' },
      { num: 3, name: 'Rúben Dias', pos: 'DF' },
      { num: 25, name: 'Akanji', pos: 'DF' },
      { num: 24, name: 'Gvardiol', pos: 'DF' },
      { num: 16, name: 'Rodri', pos: 'MF' },
      { num: 8, name: 'Kovačić', pos: 'MF' },
      { num: 17, name: 'De Bruyne', pos: 'MF' },
      { num: 20, name: 'Bernardo Silva', pos: 'FW' },
      { num: 9, name: 'Haaland', pos: 'FW' },
      { num: 47, name: 'Foden', pos: 'FW' }
    ],
    subs: [
      { num: 18, name: 'Ortega', pos: 'GK' },
      { num: 5, name: 'Stones', pos: 'DF' },
      { num: 6, name: 'Aké', pos: 'DF' },
      { num: 82, name: 'Lewis', pos: 'DF' },
      { num: 27, name: 'Matheus Nunes', pos: 'MF' },
      { num: 19, name: 'Gündoğan', pos: 'MF' },
      { num: 11, name: 'Doku', pos: 'FW' },
      { num: 10, name: 'Grealish', pos: 'FW' }
    ]
  },
  'Real Madrid': {
    formation: '4-3-3',
    manager: 'Carlo Ancelotti',
    starting: [
      { num: 1, name: 'Courtois', pos: 'GK' },
      { num: 2, name: 'Carvajal', pos: 'DF' },
      { num: 3, name: 'Militão', pos: 'DF' },
      { num: 22, name: 'Rüdiger', pos: 'DF' },
      { num: 23, name: 'Mendy', pos: 'DF' },
      { num: 14, name: 'Tchouaméni', pos: 'MF' },
      { num: 8, name: 'Valverde', pos: 'MF' },
      { num: 5, name: 'Bellingham', pos: 'MF' },
      { num: 11, name: 'Rodrygo', pos: 'FW' },
      { num: 9, name: 'Mbappé', pos: 'FW' },
      { num: 7, name: 'Vinícius Jr.', pos: 'FW' }
    ],
    subs: [
      { num: 13, name: 'Lunin', pos: 'GK' },
      { num: 17, name: 'Lucas Vázquez', pos: 'DF' },
      { num: 20, name: 'Fran García', pos: 'DF' },
      { num: 6, name: 'Camavinga', pos: 'MF' },
      { num: 10, name: 'Modrić', pos: 'MF' },
      { num: 19, name: 'Ceballos', pos: 'MF' },
      { num: 15, name: 'Arda Güler', pos: 'FW' },
      { num: 16, name: 'Endrick', pos: 'FW' }
    ]
  },
  'Barcelona': {
    formation: '4-2-3-1',
    manager: 'Hansi Flick',
    starting: [
      { num: 1, name: 'Ter Stegen', pos: 'GK' },
      { num: 23, name: 'Koundé', pos: 'DF' },
      { num: 2, name: 'Cubarsí', pos: 'DF' },
      { num: 5, name: 'Iñigo Martínez', pos: 'DF' },
      { num: 3, name: 'Balde', pos: 'DF' },
      { num: 17, name: 'Casadó', pos: 'MF' },
      { num: 8, name: 'Pedri', pos: 'MF' },
      { num: 19, name: 'Lamine Yamal', pos: 'MF' },
      { num: 20, name: 'Dani Olmo', pos: 'MF' },
      { num: 11, name: 'Raphinha', pos: 'MF' },
      { num: 9, name: 'Lewandowski', pos: 'FW' }
    ],
    subs: [
      { num: 13, name: 'Iñaki Peña', pos: 'GK' },
      { num: 4, name: 'Araújo', pos: 'DF' },
      { num: 24, name: 'Eric García', pos: 'DF' },
      { num: 6, name: 'Gavi', pos: 'MF' },
      { num: 21, name: 'De Jong', pos: 'MF' },
      { num: 16, name: 'Fermín López', pos: 'MF' },
      { num: 7, name: 'Ferran Torres', pos: 'FW' },
      { num: 18, name: 'Pau Víctor', pos: 'FW' }
    ]
  },
  'الترجي الرياضي': {
    formation: '4-3-3',
    manager: 'Laurențiu Reghecampf',
    starting: [
      { num: 1, name: 'بن سعيد', pos: 'GK' },
      { num: 2, name: 'بن علي', pos: 'DF' },
      { num: 5, name: 'توغاي', pos: 'DF' },
      { num: 6, name: 'مرياح', pos: 'DF' },
      { num: 20, name: 'بن حميدة', pos: 'DF' },
      { num: 4, name: 'أهولو', pos: 'MF' },
      { num: 8, name: 'تقا', pos: 'MF' },
      { num: 10, name: 'ساس', pos: 'MF' },
      { num: 11, name: 'موكوانا', pos: 'FW' },
      { num: 9, name: 'رودريغيز', pos: 'FW' },
      { num: 17, name: 'بلايلي', pos: 'FW' }
    ],
    subs: [
      { num: 16, name: 'دبشي', pos: 'GK' },
      { num: 13, name: 'بوشنيبة', pos: 'DF' },
      { num: 15, name: 'عمامو', pos: 'DF' },
      { num: 18, name: 'أوغبيلو', pos: 'MF' },
      { num: 21, name: 'دربالي', pos: 'MF' },
      { num: 7, name: 'سوي', pos: 'FW' },
      { num: 27, name: 'بوقرة', pos: 'FW' },
      { num: 19, name: 'بن حمودة', pos: 'FW' }
    ]
  },
  'النادي الإفريقي': {
    formation: '4-3-3',
    manager: 'David Bettoni',
    starting: [
      { num: 16, name: 'اليفرني', pos: 'GK' },
      { num: 2, name: 'الزاغلوني', pos: 'DF' },
      { num: 4, name: 'بوعبيد', pos: 'DF' },
      { num: 5, name: 'بن عبدة', pos: 'DF' },
      { num: 24, name: 'الشريفي', pos: 'DF' },
      { num: 6, name: 'سيماكولا', pos: 'MF' },
      { num: 8, name: 'الزمزمي', pos: 'MF' },
      { num: 10, name: 'الصغير', pos: 'MF' },
      { num: 11, name: 'الخضراوي', pos: 'FW' },
      { num: 9, name: 'إيدوو', pos: 'FW' },
      { num: 17, name: 'حمدي العبيدي', pos: 'FW' }
    ],
    subs: [
      { num: 1, name: 'الفرحاتي', pos: 'GK' },
      { num: 13, name: 'الغرسي', pos: 'DF' },
      { num: 3, name: 'التينيز', pos: 'DF' },
      { num: 18, name: 'خليل', pos: 'MF' },
      { num: 21, name: 'كنيسي', pos: 'MF' },
      { num: 7, name: 'الصرارفي', pos: 'FW' },
      { num: 27, name: 'علي يوسف', pos: 'FW' }
    ]
  },
  'النجم الساحلي': {
    formation: '4-2-3-1',
    manager: 'Mohamed Mkacher',
    starting: [
      { num: 1, name: 'الجمل', pos: 'GK' },
      { num: 2, name: 'بن نجيمة', pos: 'DF' },
      { num: 4, name: 'الناوالي', pos: 'DF' },
      { num: 5, name: 'الغدامسي', pos: 'DF' },
      { num: 12, name: 'بن علي', pos: 'DF' },
      { num: 6, name: 'مباي', pos: 'MF' },
      { num: 8, name: 'الجبلي', pos: 'MF' },
      { num: 10, name: 'الشماخي', pos: 'MF' },
      { num: 7, name: 'الضاوي', pos: 'MF' },
      { num: 11, name: 'العبدلي', pos: 'MF' },
      { num: 9, name: 'بونغونغا', pos: 'FW' }
    ],
    subs: [
      { num: 16, name: 'القابسي', pos: 'GK' },
      { num: 3, name: 'بن هلال', pos: 'DF' },
      { num: 14, name: 'العوادي', pos: 'MF' },
      { num: 18, name: 'سيدومار', pos: 'MF' },
      { num: 20, name: 'بن شويخة', pos: 'FW' },
      { num: 22, name: 'البريقي', pos: 'FW' }
    ]
  },
  'النادي الصفاقسي': {
    formation: '4-3-3',
    manager: 'Alexandre Santos',
    starting: [
      { num: 1, name: 'دحمان', pos: 'GK' },
      { num: 2, name: 'المحمودي', pos: 'DF' },
      { num: 4, name: 'النصراوي', pos: 'DF' },
      { num: 5, name: 'الزموري', pos: 'DF' },
      { num: 3, name: 'السايحي', pos: 'DF' },
      { num: 6, name: 'كوامي', pos: 'MF' },
      { num: 8, name: 'كونتي', pos: 'MF' },
      { num: 10, name: 'الحبوبي', pos: 'MF' },
      { num: 11, name: 'بركات', pos: 'FW' },
      { num: 9, name: 'الدريدي', pos: 'FW' },
      { num: 7, name: 'كانتي', pos: 'FW' }
    ],
    subs: [
      { num: 16, name: 'قعلول', pos: 'GK' },
      { num: 12, name: 'الهمامي', pos: 'DF' },
      { num: 14, name: 'بن علي', pos: 'MF' },
      { num: 18, name: 'الدربالي', pos: 'MF' },
      { num: 19, name: 'تراوري', pos: 'FW' }
    ]
  }
};

// Generates dynamic realistic roster for any club not explicitly hardcoded
function generateFallbackRoster(teamName, isHome) {
  const formation = isHome ? '4-3-3' : '4-2-3-1';
  const short = String(teamName || 'Team').split(' ')[0];
  const starting = [
    { num: 1, name: `${short} GK`, pos: 'GK' },
    { num: 2, name: `${short} RB`, pos: 'DF' },
    { num: 4, name: `${short} CB`, pos: 'DF' },
    { num: 5, name: `${short} CB`, pos: 'DF' },
    { num: 3, name: `${short} LB`, pos: 'DF' },
    { num: 6, name: `${short} CDM`, pos: 'MF' },
    { num: 8, name: `${short} CM`, pos: 'MF' },
    { num: 10, name: `${short} CAM`, pos: 'MF' },
    { num: 7, name: `${short} RW`, pos: 'FW' },
    { num: 9, name: `${short} ST`, pos: 'FW' },
    { num: 11, name: `${short} LW`, pos: 'FW' }
  ];
  const subs = [
    { num: 12, name: `${short} Sub GK`, pos: 'GK' },
    { num: 13, name: `${short} Sub DF`, pos: 'DF' },
    { num: 14, name: `${short} Sub MF`, pos: 'MF' },
    { num: 15, name: `${short} Sub MF`, pos: 'MF' },
    { num: 17, name: `${short} Sub FW`, pos: 'FW' },
    { num: 19, name: `${short} Sub FW`, pos: 'FW' }
  ];
  return {
    formation,
    manager: `${short} Manager`,
    starting,
    subs
  };
}

// Generate realistic match statistics based on actual score and match state
function generateMockStats(match) {
  const hScore = Number(match.home_score ?? 1);
  const aScore = Number(match.away_score ?? 0);
  const isFinished = match.status === 'FINISHED' || match.live_clock === 'FT';

  // Possession
  const basePoss = 50 + (hScore - aScore) * 3;
  const hPoss = Math.min(68, Math.max(34, Math.round(basePoss + (match.id % 7) - 3)));
  const aPoss = 100 - hPoss;

  // Shots
  const mult = isFinished ? 1 : 0.75;
  const hShots = Math.max(hScore + 3, Math.round((12 + (hScore * 2)) * mult));
  const aShots = Math.max(aScore + 2, Math.round((8 + (aScore * 2)) * mult));

  const hTarget = Math.max(hScore, Math.round(hShots * 0.42));
  const aTarget = Math.max(aScore, Math.round(aShots * 0.38));

  // xG
  const hXg = (hScore * 0.65 + hTarget * 0.15 + 0.22).toFixed(2);
  const aXg = (aScore * 0.65 + aTarget * 0.15 + 0.18).toFixed(2);

  // Corners, Fouls, Cards
  const hCorners = Math.max(1, Math.round(5 + (hPoss > 50 ? 2 : -1)));
  const aCorners = Math.max(1, Math.round(4 + (aPoss > 50 ? 2 : -1)));

  const hFouls = Math.round(9 + (match.id % 5));
  const aFouls = Math.round(11 + (match.id % 4));

  const hYellow = Math.min(4, Math.max(0, Math.round((hFouls / 4.5))));
  const aYellow = Math.min(5, Math.max(1, Math.round((aFouls / 3.8))));

  return [
    { key: 'possession', labelEn: 'Ball Possession', labelAr: 'الاستحواذ على الكرة', home: `${hPoss}%`, away: `${aPoss}%`, homeVal: hPoss, awayVal: aPoss },
    { key: 'xg', labelEn: 'Expected Goals (xG)', labelAr: 'الأهداف المتوقعة (xG)', home: hXg, away: aXg, homeVal: parseFloat(hXg), awayVal: parseFloat(aXg) },
    { key: 'shots', labelEn: 'Total Shots', labelAr: 'إجمالي التسديدات', home: hShots, away: aShots, homeVal: hShots, awayVal: aShots },
    { key: 'target', labelEn: 'Shots on Target', labelAr: 'التسديدات على المرمى', home: hTarget, away: aTarget, homeVal: hTarget, awayVal: aTarget },
    { key: 'corners', labelEn: 'Corner Kicks', labelAr: 'الضربات الركنية', home: hCorners, away: aCorners, homeVal: hCorners, awayVal: aCorners },
    { key: 'fouls', labelEn: 'Fouls Committed', labelAr: 'الأخطاء المرتكبة', home: hFouls, away: aFouls, homeVal: hFouls, awayVal: aFouls, reverseBetter: true },
    { key: 'yellow_cards', labelEn: 'Yellow Cards', labelAr: 'البطاقات الصفراء', home: hYellow, away: aYellow, homeVal: hYellow, awayVal: aYellow, reverseBetter: true },
    { key: 'red_cards', labelEn: 'Red Cards', labelAr: 'البطاقات الحمراء', home: 0, away: 0, homeVal: 0, awayVal: 0, reverseBetter: true },
    { key: 'offsides', labelEn: 'Offsides', labelAr: 'حالات التسلل', home: 2, away: 1, homeVal: 2, awayVal: 1, reverseBetter: true },
    { key: 'saves', labelEn: 'Goalkeeper Saves', labelAr: 'تصديات الحارس', home: aTarget > 0 ? aTarget - aScore : 2, away: hTarget > 0 ? hTarget - hScore : 3, homeVal: Math.max(0, aTarget - aScore), awayVal: Math.max(0, hTarget - hScore) }
  ];
}

export default function MatchDetailsModal({ match, lang = 'ar', t = {}, liveTimerText, onClose, onOpenPrediction }) {
  const isAr = lang === 'ar';
  const [activeTab, setActiveTab] = useState('stats'); // 'stats' | 'lineups'
  const [realDetails, setRealDetails] = useState(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Attempt to fetch real details from backend if available
  useEffect(() => {
    let isMounted = true;
    if (match?.id) {
      api(`/matches/${match.id}/details`)
        .then((data) => {
          if (isMounted && data) {
            setRealDetails(data);
          }
        })
        .catch(() => {
          // Silently fallback to mock data
        });
    }
    return () => {
      isMounted = false;
    };
  }, [match?.id]);

  if (!match) return null;

  const finished = match.status === 'FINISHED' || match.live_clock === 'FT';
  const isLive = match.status === 'IN_PLAY' || match.status === 'PAUSED' || Boolean(match.live_clock);
  const homeScore = match.home_score;
  const awayScore = match.away_score;
  const hasScore = homeScore != null && awayScore != null;

  // Resolve Rosters
  const homeRoster = KNOWN_ROSTERS[match.home_team] || generateFallbackRoster(match.home_team, true);
  const awayRoster = KNOWN_ROSTERS[match.away_team] || generateFallbackRoster(match.away_team, false);

  // Resolve Stats (Real if available, else generated realistic mock)
  const statsList = generateMockStats(match);

  // Competition Logo
  const compLogo = LEAGUE_LOGOS[match.competition_code] || LEAGUE_LOGOS.TUN;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4 overflow-y-auto"
      onClick={onClose}
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <div
        className="relative flex flex-col w-full max-w-4xl max-h-[94vh] rounded-3xl border border-white/10 bg-[#0E1214] text-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ================= HEADER SECTION ================= */}
        <div className="relative border-b border-white/10 bg-gradient-to-b from-[#182025] to-[#0E1214] px-4 py-4 sm:px-6 sm:py-5">
          {/* Top Bar: League Badge & Close Button */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {compLogo && (
                <img
                  src={compLogo}
                  alt={match.competition_code || 'League'}
                  className="h-6 w-6 object-contain rounded-md bg-white/5 p-0.5"
                />
              )}
              <span className="text-xs font-black uppercase tracking-wider text-gray-300">
                {match.competition_code} {match.round_label ? `• ${match.round_label}` : ''}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {onOpenPrediction && (
                <button
                  type="button"
                  onClick={onOpenPrediction}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#53FC18]/15 border border-[#53FC18]/30 px-3 py-1.5 text-xs font-black text-[#53FC18] hover:bg-[#53FC18] hover:text-black transition active:scale-95"
                >
                  <span>🎯</span>
                  <span>{isAr ? 'التوقع' : 'Predict'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-gray-300 hover:bg-white/20 hover:text-white transition"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Teams Matchup & Score Hero */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6 py-2">
            {/* Home Team */}
            <div className="flex flex-col items-center text-center gap-2 min-w-0">
              <div className="flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-2xl bg-[#161C20] p-3 border border-white/10 shadow-lg shadow-black/40">
                {match.home_crest ? (
                  <img
                    src={match.home_crest}
                    alt={match.home_team}
                    className="h-full w-full object-contain drop-shadow"
                  />
                ) : (
                  <span className="text-base font-black text-gray-400">
                    {String(match.home_team || 'H').slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              <span className="w-full text-xs sm:text-base font-black text-white truncate" title={match.home_team}>
                {match.home_team}
              </span>
              <span className="text-[11px] font-bold text-emerald-400/90 bg-emerald-950/40 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                {homeRoster.formation}
              </span>
            </div>

            {/* Center: Live Timer, Big Score & Match Status */}
            <div className="flex flex-col items-center justify-center gap-1.5 px-2">
              {/* Status / Clock Pill */}
              {isLive ? (
                <div className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/15 px-3 py-0.5 text-xs font-mono font-black text-red-400 animate-pulse">
                  <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
                  <span>{liveTimerText || (match.live_clock ? `${match.live_clock}'` : 'LIVE')}</span>
                </div>
              ) : finished ? (
                <span className="rounded-full border border-gray-600 bg-gray-800/80 px-3 py-0.5 text-xs font-black uppercase tracking-wider text-gray-300">
                  {isAr ? 'انتهت (FT)' : 'Full Time'}
                </span>
              ) : (
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-0.5 text-xs font-bold text-gray-400">
                  {new Date(match.utc_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                </span>
              )}

              {/* Big Score Typography */}
              <div className="flex items-center justify-center min-w-[90px] sm:min-w-[120px] h-12 sm:h-14 rounded-2xl bg-[#090C0E] border border-white/10 px-4 font-mono shadow-inner">
                {hasScore ? (
                  <div className="flex items-center gap-2 sm:gap-3 text-2xl sm:text-3xl font-black tracking-tight text-white">
                    <span>{homeScore}</span>
                    <span className="text-[#53FC18] text-lg font-bold">:</span>
                    <span>{awayScore}</span>
                  </div>
                ) : (
                  <span className="text-sm sm:text-base font-black tracking-widest text-gray-400">VS</span>
                )}
              </div>

              {/* Halftime score if exists */}
              {match.home_ht != null && match.away_ht != null && (
                <span className="text-[10px] font-bold text-gray-400">
                  {isAr ? `(الشوط الأول: ${match.home_ht} - ${match.away_ht})` : `(HT: ${match.home_ht} - ${match.away_ht})`}
                </span>
              )}
            </div>

            {/* Away Team */}
            <div className="flex flex-col items-center text-center gap-2 min-w-0">
              <div className="flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-2xl bg-[#161C20] p-3 border border-white/10 shadow-lg shadow-black/40">
                {match.away_crest ? (
                  <img
                    src={match.away_crest}
                    alt={match.away_team}
                    className="h-full w-full object-contain drop-shadow"
                  />
                ) : (
                  <span className="text-base font-black text-gray-400">
                    {String(match.away_team || 'A').slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              <span className="w-full text-xs sm:text-base font-black text-white truncate" title={match.away_team}>
                {match.away_team}
              </span>
              <span className="text-[11px] font-bold text-amber-400/90 bg-amber-950/40 border border-amber-500/20 px-2 py-0.5 rounded-full">
                {awayRoster.formation}
              </span>
            </div>
          </div>

          {/* TAB SYSTEM BUTTONS */}
          <div className="mt-4 flex items-center justify-center gap-2 border-t border-white/5 pt-3">
            <button
              type="button"
              onClick={() => setActiveTab('stats')}
              className={`flex items-center gap-2 rounded-xl px-5 py-2 text-xs sm:text-sm font-black transition-all ${
                activeTab === 'stats'
                  ? 'bg-[#53FC18] text-black shadow-lg shadow-[#53FC18]/20 scale-105'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span>📊</span>
              <span>{isAr ? 'الإحصائيات' : 'Match Stats'}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('lineups')}
              className={`flex items-center gap-2 rounded-xl px-5 py-2 text-xs sm:text-sm font-black transition-all ${
                activeTab === 'lineups'
                  ? 'bg-[#53FC18] text-black shadow-lg shadow-[#53FC18]/20 scale-105'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span>📋</span>
              <span>{isAr ? 'التشكيلات والملعب' : 'Lineups & Pitch'}</span>
            </button>
          </div>
        </div>

        {/* ================= BODY CONTENT ================= */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* TAB 1: MATCH STATS */}
          {activeTab === 'stats' && (
            <div className="space-y-4">
              {/* Category Legend */}
              <div className="flex items-center justify-between text-xs font-bold text-gray-400 px-2">
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  {match.home_team}
                </span>
                <span className="text-gray-500">{isAr ? 'مقارنة الأداء' : 'Head-to-Head Comparison'}</span>
                <span className="flex items-center gap-1.5 text-amber-400">
                  {match.away_team}
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                </span>
              </div>

              {/* Stats Progress Bars */}
              <div className="rounded-2xl border border-white/5 bg-[#14181B] p-3 sm:p-5 space-y-4">
                {statsList.map((st) => {
                  const total = (st.homeVal || 0) + (st.awayVal || 0);
                  const hPct = total > 0 ? Math.round(((st.homeVal || 0) / total) * 100) : 50;
                  const aPct = 100 - hPct;
                  const homeIsBetter = st.reverseBetter ? st.homeVal < st.awayVal : st.homeVal > st.awayVal;
                  const awayIsBetter = st.reverseBetter ? st.awayVal < st.homeVal : st.awayVal > st.homeVal;

                  return (
                    <div key={st.key} className="space-y-1.5">
                      {/* Metric Numbers & Label */}
                      <div className="flex items-center justify-between text-xs sm:text-sm">
                        <span className={`font-mono font-black ${homeIsBetter ? 'text-emerald-400' : 'text-gray-300'}`}>
                          {st.home}
                        </span>
                        <span className="text-xs font-extrabold text-gray-400 text-center truncate px-2">
                          {isAr ? st.labelAr : st.labelEn}
                        </span>
                        <span className={`font-mono font-black ${awayIsBetter ? 'text-amber-400' : 'text-gray-300'}`}>
                          {st.away}
                        </span>
                      </div>

                      {/* Dual Progress Bar */}
                      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[#090C0E] border border-white/5 p-0.5">
                        <div
                          className="h-full rounded-l-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500"
                          style={{ width: `${hPct}%` }}
                        />
                        <div
                          className="h-full rounded-r-full bg-gradient-to-r from-amber-400 to-amber-600 transition-all duration-500"
                          style={{ width: `${aPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: LINEUPS & SOCCER PITCH */}
          {activeTab === 'lineups' && (
            <div className="space-y-6">
              {/* Formations Header Bar */}
              <div className="flex items-center justify-between bg-[#14181B] border border-white/5 rounded-2xl p-3 text-xs sm:text-sm font-bold">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-emerald-500" />
                  <span className="text-white font-extrabold">{match.home_team}</span>
                  <span className="text-emerald-400 font-mono">({homeRoster.formation})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-amber-400 font-mono">({awayRoster.formation})</span>
                  <span className="text-white font-extrabold">{match.away_team}</span>
                  <span className="h-3 w-3 rounded-full bg-amber-500" />
                </div>
              </div>

              {/* CSS Tactical Soccer Pitch */}
              <div className="relative mx-auto w-full max-w-[560px] aspect-[2/3] min-h-[580px] rounded-3xl border-2 border-white/30 bg-[#165B33] shadow-2xl overflow-hidden select-none">
                {/* Grass Striping Pattern */}
                <div className="absolute inset-0 bg-[repeating-linear-gradient(to_bottom,#165B33_0px,#165B33_40px,#134F2C_40px,#134F2C_80px)] opacity-90" />

                {/* Outer Field Lines */}
                <div className="absolute inset-2 sm:inset-3 border-2 border-white/40 rounded-xl pointer-events-none" />

                {/* Halfway Line & Center Circle */}
                <div className="absolute top-1/2 left-2 right-2 sm:left-3 sm:right-3 border-t-2 border-white/40 -translate-y-1/2 pointer-events-none" />
                <div className="absolute top-1/2 left-1/2 h-24 w-24 sm:h-28 sm:w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/40 pointer-events-none" />
                <div className="absolute top-1/2 left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/60 pointer-events-none" />

                {/* Top Penalty Box (Away Defense / Home Attack) */}
                <div className="absolute top-2 sm:top-3 left-1/2 -translate-x-1/2 w-44 sm:w-56 h-20 sm:h-24 border-b-2 border-x-2 border-white/40 bg-white/[0.02] pointer-events-none" />
                <div className="absolute top-2 sm:top-3 left-1/2 -translate-x-1/2 w-20 sm:w-28 h-8 sm:h-10 border-b-2 border-x-2 border-white/40 pointer-events-none" />
                <div className="absolute top-16 sm:top-20 left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full bg-white/60 pointer-events-none" />

                {/* Bottom Penalty Box (Home Defense / Away Attack) */}
                <div className="absolute bottom-2 sm:bottom-3 left-1/2 -translate-x-1/2 w-44 sm:w-56 h-20 sm:h-24 border-t-2 border-x-2 border-white/40 bg-white/[0.02] pointer-events-none" />
                <div className="absolute bottom-2 sm:bottom-3 left-1/2 -translate-x-1/2 w-20 sm:w-28 h-8 sm:h-10 border-t-2 border-x-2 border-white/40 pointer-events-none" />
                <div className="absolute bottom-16 sm:bottom-20 left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full bg-white/60 pointer-events-none" />

                {/* ================= AWAY PLAYERS (TOP HALF) ================= */}
                {renderTacticalFormation(awayRoster.starting, awayRoster.formation, false)}

                {/* ================= HOME PLAYERS (BOTTOM HALF) ================= */}
                {renderTacticalFormation(homeRoster.starting, homeRoster.formation, true)}
              </div>

              {/* ================= BENCH & MANAGERS ================= */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Home Substitutes Card */}
                <div className="rounded-2xl border border-white/10 bg-[#14181B] p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="text-xs font-black uppercase text-emerald-400">
                      {isAr ? 'بدلاء' : 'Substitutes'} • {match.home_team}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      {isAr ? 'المدرب:' : 'Coach:'} <strong className="text-white">{homeRoster.manager}</strong>
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {homeRoster.subs.map((p) => (
                      <div key={p.num} className="flex items-center gap-2 rounded-lg bg-black/30 p-1.5 border border-white/5">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] font-mono font-bold text-emerald-400">
                          {p.num}
                        </span>
                        <span className="truncate text-gray-200 font-semibold">{p.name}</span>
                        <span className="text-[9px] text-gray-500 uppercase ml-auto">{p.pos}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Away Substitutes Card */}
                <div className="rounded-2xl border border-white/10 bg-[#14181B] p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="text-xs font-black uppercase text-amber-400">
                      {isAr ? 'بدلاء' : 'Substitutes'} • {match.away_team}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      {isAr ? 'المدرب:' : 'Coach:'} <strong className="text-white">{awayRoster.manager}</strong>
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {awayRoster.subs.map((p) => (
                      <div key={p.num} className="flex items-center gap-2 rounded-lg bg-black/30 p-1.5 border border-white/5">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-[10px] font-mono font-bold text-amber-400">
                          {p.num}
                        </span>
                        <span className="truncate text-gray-200 font-semibold">{p.name}</span>
                        <span className="text-[9px] text-gray-500 uppercase ml-auto">{p.pos}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Calculates responsive tactical player nodes on the pitch
 * isHome = true (Bottom half, attacking upwards)
 * isHome = false (Top half, attacking downwards)
 */
function renderTacticalFormation(players = [], formationStr = '4-3-3', isHome = true) {
  if (!players || players.length < 11) return null;

  // Split formation, e.g. '4-3-3' -> [4, 3, 3] or '4-2-3-1' -> [4, 2, 3, 1]
  const rows = formationStr.split('-').map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
  if (rows.length === 0) rows.push(4, 3, 3);

  // Row breakdown with Goalkeeper as row 0
  const lineStructure = [1, ...rows]; // e.g. [1, 4, 3, 3]
  let playerIdx = 0;

  const totalLines = lineStructure.length;

  return (
    <div className="absolute inset-0 pointer-events-auto">
      {lineStructure.map((countInRow, lineIdx) => {
        // Vertical positioning
        // Home: Line 0 (GK) at ~93%, Line N (FW) at ~57%
        // Away: Line 0 (GK) at ~7%, Line N (FW) at ~43%
        let topPct = 0;
        if (isHome) {
          const tMin = 58;
          const tMax = 93;
          topPct = tMax - (lineIdx / (totalLines - 1)) * (tMax - tMin);
        } else {
          const tMin = 7;
          const tMax = 42;
          topPct = tMin + (lineIdx / (totalLines - 1)) * (tMax - tMin);
        }

        const rowPlayers = [];
        for (let i = 0; i < countInRow; i++) {
          if (playerIdx < players.length) {
            rowPlayers.push({
              player: players[playerIdx],
              leftPct: ((i + 1) / (countInRow + 1)) * 100
            });
            playerIdx++;
          }
        }

        return (
          <React.Fragment key={`line-${isHome ? 'h' : 'a'}-${lineIdx}`}>
            {rowPlayers.map(({ player, leftPct }) => (
              <div
                key={player.num}
                className="absolute flex flex-col items-center justify-center -translate-x-1/2 -translate-y-1/2 transition-transform hover:scale-110 cursor-pointer"
                style={{ top: `${topPct}%`, left: `${leftPct}%` }}
              >
                {/* Player Jersey Circle */}
                <div
                  className={`flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full border-2 shadow-md ${
                    isHome
                      ? player.pos === 'GK'
                        ? 'bg-amber-400 border-white text-black'
                        : 'bg-emerald-600 border-white text-white'
                      : player.pos === 'GK'
                      ? 'bg-purple-600 border-white text-white'
                      : 'bg-rose-600 border-white text-white'
                  }`}
                >
                  <span className="text-[10px] sm:text-xs font-mono font-black">{player.num}</span>
                </div>

                {/* Player Name Tag */}
                <span className="mt-0.5 max-w-[68px] sm:max-w-[76px] truncate rounded bg-black/75 px-1.5 py-0.2 text-[9px] sm:text-[10px] font-extrabold text-white text-center shadow-sm">
                  {player.name}
                </span>
              </div>
            ))}
          </React.Fragment>
        );
      })}
    </div>
  );
}
