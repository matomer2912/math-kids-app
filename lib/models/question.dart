enum Operation { addition, subtraction, multiplication, division }

extension OperationExtension on Operation {
  String get symbol {
    switch (this) {
      case Operation.addition: return '+';
      case Operation.subtraction: return '−';
      case Operation.multiplication: return '×';
      case Operation.division: return '÷';
    }
  }

  String get hebrewName {
    switch (this) {
      case Operation.addition: return 'חיבור';
      case Operation.subtraction: return 'חיסור';
      case Operation.multiplication: return 'כפל';
      case Operation.division: return 'חילוק';
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
