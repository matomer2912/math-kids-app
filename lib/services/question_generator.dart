import 'dart:math';
import '../models/question.dart';

class QuestionGenerator {
  final Random _random = Random();

  Question generate(List<Operation> operations, int maxNumber, {List<String>? hardQuestionKeys}) {
    if (hardQuestionKeys != null && hardQuestionKeys.isNotEmpty && _random.nextDouble() < 0.7) {
      final key = hardQuestionKeys[_random.nextInt(hardQuestionKeys.length)];
      final q = _parseKey(key);
      if (q != null) return q;
    }
    final op = operations[_random.nextInt(operations.length)];
    return _generateForOperation(op, maxNumber);
  }

  Question _generateForOperation(Operation op, int maxNumber) {
    switch (op) {
      case Operation.addition:
        final a = _random.nextInt(maxNumber) + 1;
        final b = _random.nextInt(maxNumber) + 1;
        return Question(a: a, b: b, operation: op, correctAnswer: a + b);
      case Operation.subtraction:
        final a = _random.nextInt(maxNumber) + 1;
        final b = _random.nextInt(a) + 1;
        return Question(a: a, b: b, operation: op, correctAnswer: a - b);
      case Operation.multiplication:
        final a = _random.nextInt(min(maxNumber, 12)) + 1;
        final b = _random.nextInt(min(maxNumber, 12)) + 1;
        return Question(a: a, b: b, operation: op, correctAnswer: a * b);
      case Operation.division:
        final b = _random.nextInt(min(maxNumber, 12)) + 1;
        final result = _random.nextInt(min(maxNumber, 12)) + 1;
        final a = b * result;
        return Question(a: a, b: b, operation: op, correctAnswer: result);
    }
  }

  Question? _parseKey(String key) {
    for (final op in Operation.values) {
      final sym = op.symbol;
      final idx = key.indexOf(sym);
      if (idx > 0) {
        final a = int.tryParse(key.substring(0, idx));
        final b = int.tryParse(key.substring(idx + sym.length));
        if (a != null && b != null) {
          int answer;
          switch (op) {
            case Operation.addition: answer = a + b; break;
            case Operation.subtraction: answer = a - b; break;
            case Operation.multiplication: answer = a * b; break;
            case Operation.division:
              if (b == 0) return null;
              answer = a ~/ b;
              break;
          }
          return Question(a: a, b: b, operation: op, correctAnswer: answer);
        }
      }
    }
    return null;
  }
}
