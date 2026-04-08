// ignore_for_file: non_constant_identifier_names

/// All Hebrew strings in one place — keeps source files encoding-safe
class S {
  // App
  static const appTitle = '\u05de\u05ea\u05de\u05d8\u05d9\u05e7\u05d4 \u05db\u05d9\u05e4\u05d5\u05ea\u05d9\u05ea \ud83c\udf89'; // מתמטיקה כיפית 🎉

  // Operations
  static const opAddition      = '\u05d7\u05d9\u05d1\u05d5\u05e8';      // חיבור
  static const opSubtraction   = '\u05d7\u05d9\u05e1\u05d5\u05e8';   // חיסור
  static const opMultiplication= '\u05db\u05e4\u05dc'; // כפל
  static const opDivision      = '\u05d7\u05d9\u05dc\u05d5\u05e7';      // חילוק

  // Home screen
  static const chooseOperations   = '\u05d1\u05d7\u05e8 \u05e4\u05e2\u05d5\u05dc\u05d5\u05ea \u05d7\u05e9\u05d1\u05d5\u05df';   // בחר פעולות חשבון
  static const questionCount      = '\u05de\u05e1\u05e4\u05e8 \u05e9\u05d0\u05dc\u05d5\u05ea';       // מספר שאלות
  static const numberLevel        = '\u05d2\u05d5\u05d1\u05d4 \u05d4\u05de\u05e1\u05e4\u05e8\u05d9\u05dd';         // גובה המספרים
  static const levelEasy          = '\u05e2\u05d3 50\n\u05e7\u05dc';          // עד 50\nקל
  static const levelMedium        = '\u05e2\u05d3 100\n\u05d1\u05d9\u05e0\u05d5\u05e0\u05d9';        // עד 100\nבינוני
  static const levelHard          = '\u05e2\u05d3 200\n\u05e7\u05e9\u05d4';          // עד 200\nקשה
  static const hardModeSection    = '\ud83c\udfaf \u05de\u05e6\u05d1 \u05ea\u05e8\u05d2\u05d5\u05dc \u05de\u05d9\u05d5\u05d7\u05d3'; // 🎯 מצב תרגול מיוחד
  static const hardModeLabel      = '\u05ea\u05e8\u05d2\u05dc \u05d0\u05ea \u05d4\u05ea\u05e8\u05d2\u05d9\u05dc\u05d9\u05dd \u05d4\u05e7\u05e9\u05d9\u05dd \u05e9\u05dc\u05da'; // תרגל את התרגילים הקשים שלך
  static String hardModeSubtitle(int count) =>
      '\u05d6\u05d5\u05d9\u05d4\u05d5 $count \u05ea\u05e8\u05d2\u05d9\u05dc\u05d9\u05dd \u05e9\u05e6\u05e8\u05d9\u05db\u05d9\u05dd \u05ea\u05e8\u05d2\u05d5\u05dc'; // זוהו X תרגילים שצריכים תרגול
  static const startGame          = '\ud83d\ude80 \u05d4\u05ea\u05d7\u05dc \u05de\u05e9\u05d7\u05e7!'; // 🚀 התחל משחק!
  static const noOpSelected       = '\u05d1\u05d7\u05e8\u05d9 \u05dc\u05e4\u05d7\u05d5\u05ea \u05e4\u05e2\u05d5\u05dc\u05d4 \u05d0\u05d7\u05ea'; // בחרי לפחות פעולה אחת
  static const highScoresTooltip  = '\u05e9\u05d9\u05d0\u05d9\u05dd';  // שיאים

  // Game screen
  static String questionProgress(int current, int total) =>
      '\u05e9\u05d0\u05dc\u05d4 $current \u05de\u05ea\u05d5\u05da $total'; // שאלה X מתוך Y
  static const checkAnswer  = '\u05d1\u05d3\u05d5\u05e7 \u05ea\u05e9\u05d5\u05d1\u05d4';  // בדוק תשובה
  static const correct      = '\u2705 \u05e0\u05db\u05d5\u05df!';      // ✅ נכון!
  static String wrong(int answer) =>
      '\u274c \u05d4\u05ea\u05e9\u05d5\u05d1\u05d4 \u05d4\u05e0\u05db\u05d5\u05e0\u05d4: $answer'; // ❌ התשובה הנכונה: X
  static String streak(int n) => '\u05e8\u05e6\u05e3: $n';    // רצף: X
  static const flameText    = '\ud83d\udd25\ud83d\udd25\ud83d\udd25';    // 🔥🔥🔥
  static const flameMessage = '\u05de\u05d3\u05d4\u05d9\u05dd! 5 \u05d1\u05e8\u05e6\u05e3!'; // מדהים! 5 ברצף!

  // Results screen
  static const resultsTitle   = '\u05ea\u05d5\u05e6\u05d0\u05d5\u05ea';   // תוצאות
  static String correctOf(int correct, int total) =>
      '$correct \u05de\u05ea\u05d5\u05da $total \u05e0\u05db\u05d5\u05e0\u05d5\u05ea'; // X מתוך Y נכונות
  static String points(int n) => '$n \u05e0\u05e7\u05d5\u05d3\u05d5\u05ea';         // X נקודות
  static String hardUnlocked(int runs) =>
      '\ud83c\udfaf \u05d0\u05d7\u05e8\u05d9 $runs \u05e8\u05d9\u05e6\u05d5\u05ea \u05d6\u05d5\u05d9\u05d4\u05d5 \u05dc\u05da \u05ea\u05e8\u05d2\u05d9\u05dc\u05d9\u05dd \u05dc\u05ea\u05e8\u05d2\u05d5\u05dc \u05de\u05d9\u05d5\u05d7\u05d3!';
  static const backToMenu     = '\u05d7\u05d6\u05d5\u05e8 \u05dc\u05ea\u05e4\u05e8\u05d9\u05d8 \u05d4\u05e8\u05d0\u05e9\u05d9';     // חזור לתפריט הראשי

  // High scores
  static const highScoresTitle    = '\ud83c\udfc6 \u05e9\u05d9\u05d0\u05d9\u05dd';    // 🏆 שיאים
  static const noScoresYet        = '\u05e2\u05d3\u05d9\u05d9\u05df \u05d0\u05d9\u05df \u05e9\u05d9\u05d0\u05d9\u05dd.\n\u05e9\u05d7\u05e7 \u05de\u05e9\u05d7\u05e7 \u05e8\u05d0\u05e9\u05d5\u05df!'; // עדיין אין שיאים.\nשחק משחק ראשון!

  // Operation display names (for scores key formatting)
  static const Map<String, String> opNames = {
    'addition':       '\u05d7\u05d9\u05d1\u05d5\u05e8',
    'subtraction':    '\u05d7\u05d9\u05e1\u05d5\u05e8',
    'multiplication': '\u05db\u05e4\u05dc',
    'division':       '\u05d7\u05d9\u05dc\u05d5\u05e7',
  };
  static String upTo(int n) => '\u05e2\u05d3 $n'; // עד X
}
