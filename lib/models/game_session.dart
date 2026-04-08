import 'question.dart';

class QuestionResult {
  final Question question;
  final int userAnswer;
  final bool isCorrect;
  final int points;

  const QuestionResult({
    required this.question,
    required this.userAnswer,
    required this.isCorrect,
    required this.points,
  });
}

class GameSession {
  final List<Operation> operations;
  final int maxNumber;
  final int totalQuestions;
  final List<QuestionResult> results;
  final DateTime startTime;

  GameSession({
    required this.operations,
    required this.maxNumber,
    required this.totalQuestions,
    List<QuestionResult>? results,
  })  : results = results ?? [],
        startTime = DateTime.now();

  int get totalScore => results.fold(0, (sum, r) => sum + r.points);
  int get correctCount => results.where((r) => r.isCorrect).length;
  bool get isComplete => results.length >= totalQuestions;

  String get operationsKey => operations.map((o) => o.name).join('-');
}
