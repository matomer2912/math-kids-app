import '../constants/strings.dart';

enum Operation { addition, subtraction, multiplication, division }

extension OperationExtension on Operation {
  String get symbol {
    switch (this) {
      case Operation.addition:       return '+';
      case Operation.subtraction:    return '\u2212';
      case Operation.multiplication: return '\u00d7';
      case Operation.division:       return '\u00f7';
    }
  }

  String get hebrewName {
    switch (this) {
      case Operation.addition:       return S.opAddition;
      case Operation.subtraction:    return S.opSubtraction;
      case Operation.multiplication: return S.opMultiplication;
      case Operation.division:       return S.opDivision;
    }
  }
}

class Question {
  final int a;
  final int b;
  final Operation operation;
  final int correctAnswer;

  const Question({
    required this.a,
    required this.b,
    required this.operation,
    required this.correctAnswer,
  });

  String get key => '$a${operation.symbol}$b';

  String get display => '$a ${operation.symbol} $b = ?';
}
