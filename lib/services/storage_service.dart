import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

class StorageService {
  static const _highScoresKey = 'high_scores';
  static const _errorCountsKey = 'error_counts';
  static const _runCountKey = 'run_count';

  // High scores: key = operationsKey+maxNumber, value = score
  Future<Map<String, int>> getHighScores() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_highScoresKey);
    if (raw == null) return {};
    return Map<String, int>.from(jsonDecode(raw));
  }

  Future<void> saveHighScore(String key, int score) async {
    final prefs = await SharedPreferences.getInstance();
    final scores = await getHighScores();
    if ((scores[key] ?? 0) < score) {
      scores[key] = score;
      await prefs.setString(_highScoresKey, jsonEncode(scores));
    }
  }

  // Error tracking per question key
  Future<Map<String, int>> getErrorCounts() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_errorCountsKey);
    if (raw == null) return {};
    return Map<String, int>.from(jsonDecode(raw));
  }

  Future<void> recordErrors(List<String> wrongQuestionKeys) async {
    final prefs = await SharedPreferences.getInstance();
    final counts = await getErrorCounts();
    for (final key in wrongQuestionKeys) {
      counts[key] = (counts[key] ?? 0) + 1;
    }
    await prefs.setString(_errorCountsKey, jsonEncode(counts));
  }

  Future<int> incrementRunCount() async {
    final prefs = await SharedPreferences.getInstance();
    final count = (prefs.getInt(_runCountKey) ?? 0) + 1;
    await prefs.setInt(_runCountKey, count);
    return count;
  }

  Future<int> getRunCount() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getInt(_runCountKey) ?? 0;
  }

  // Returns top 20% most-failed question keys (min 5 errors each)
  Future<List<String>> getHardQuestions() async {
    final counts = await getErrorCounts();
    if (counts.isEmpty) return [];
    final sorted = counts.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    final topCount = (sorted.length * 0.2).ceil().clamp(1, sorted.length);
    return sorted
        .take(topCount)
        .where((e) => e.value >= 2)
        .map((e) => e.key)
        .toList();
  }
}
