import 'package:flutter/material.dart';
import '../models/question.dart';
import '../models/game_session.dart';
import '../services/question_generator.dart';
import '../services/storage_service.dart';
import '../widgets/ad_banner_widget.dart';
import '../widgets/flame_widget.dart';
import '../theme/app_theme.dart';
import 'results_screen.dart';

class GameScreen extends StatefulWidget {
  final List<Operation> operations;
  final int questionCount;
  final int maxNumber;
  final List<String>? hardQuestionKeys;

  const GameScreen({
    super.key,
    required this.operations,
    required this.questionCount,
    required this.maxNumber,
    this.hardQuestionKeys,
  });

  @override
  State<GameScreen> createState() => _GameScreenState();
}

class _GameScreenState extends State<GameScreen> with SingleTickerProviderStateMixin {
  final _generator = QuestionGenerator();
  final _storage = StorageService();
  final _controller = TextEditingController();
  final _focusNode = FocusNode();

  late GameSession _session;
  late Question _currentQuestion;
  int _streak = 0;
  bool _showFlame = false;
  bool _answered = false;
  bool? _lastCorrect;
  DateTime? _questionStart;

  late AnimationController _shakeController;
  late Animation<double> _shakeAnim;

  @override
  void initState() {
    super.initState();
    _session = GameSession(
      operations: widget.operations,
      maxNumber: widget.maxNumber,
      totalQuestions: widget.questionCount,
    );
    _shakeController = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 400));
    _shakeAnim = Tween(begin: 0.0, end: 1.0).animate(
        CurvedAnimation(parent: _shakeController, curve: Curves.elasticIn));
    _nextQuestion();
  }

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    _shakeController.dispose();
    super.dispose();
  }

  void _nextQuestion() {
    setState(() {
      _currentQuestion = _generator.generate(
        widget.operations,
        widget.maxNumber,
        hardQuestionKeys: widget.hardQuestionKeys,
      );
      _controller.clear();
      _answered = false;
      _lastCorrect = null;
      _questionStart = DateTime.now();
    });
    Future.delayed(const Duration(milliseconds: 100), () {
      if (mounted) _focusNode.requestFocus();
    });
  }

  void _submitAnswer() {
    if (_answered) return;
    final input = int.tryParse(_controller.text.trim());
    if (input == null) return;

    final elapsed = DateTime.now().difference(_questionStart!).inSeconds;
    final isCorrect = input == _currentQuestion.correctAnswer;

    int points = 0;
    if (isCorrect) {
      points = 10;
      if (elapsed <= 5) { points += 5; }
      else if (elapsed <= 10) { points += 2; }
      _streak++;
    } else {
      _streak = 0;
      _shakeController.forward(from: 0);
    }

    final result = QuestionResult(
      question: _currentQuestion,
      userAnswer: input,
      isCorrect: isCorrect,
      points: points,
    );
    _session.results.add(result);

    setState(() {
      _answered = true;
      _lastCorrect = isCorrect;
      if (_streak > 0 && _streak % 5 == 0) _showFlame = true;
    });

    if (!_showFlame) {
      Future.delayed(const Duration(milliseconds: 800), _advance);
    }
  }

  void _advance() {
    if (_session.isComplete) {
      _finishGame();
    } else {
      _nextQuestion();
    }
  }

  Future<void> _finishGame() async {
    final wrongKeys = _session.results
        .where((r) => !r.isCorrect)
        .map((r) => r.question.key)
        .toList();

    final scoreKey = '${_session.operationsKey}_${widget.maxNumber}';
    await _storage.saveHighScore(scoreKey, _session.totalScore);
    await _storage.recordErrors(wrongKeys);
    final runCount = await _storage.incrementRunCount();

    if (!mounted) return;
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(
        builder: (_) => ResultsScreen(session: _session, runCount: runCount),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final progress = _session.results.length / widget.questionCount;

    return Scaffold(
      appBar: AppBar(
        title: Text(
            'שאלה ${_session.results.length + 1} מתוך ${widget.questionCount}'),
        automaticallyImplyLeading: false,
      ),
      body: Stack(
        children: [
          Column(
            children: [
              LinearProgressIndicator(
                value: progress,
                minHeight: 8,
                backgroundColor: Colors.grey[200],
                color: AppTheme.primary,
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(children: [
                      const Icon(Icons.star, color: AppTheme.accent, size: 20),
                      const SizedBox(width: 4),
                      Text('${_session.totalScore}',
                          style: const TextStyle(
                              fontSize: 18, fontWeight: FontWeight.bold)),
                    ]),
                    if (_streak > 0)
                      Row(children: [
                        const Text('🔥', style: TextStyle(fontSize: 18)),
                        Text(' רצף: $_streak',
                            style: const TextStyle(
                                fontSize: 16, fontWeight: FontWeight.bold,
                                color: Colors.orange)),
                      ]),
                  ],
                ),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      AnimatedBuilder(
                        animation: _shakeAnim,
                        builder: (_, child) => Transform.translate(
                          offset: Offset(
                              _shakeAnim.value * 8 *
                                  (_shakeController.isAnimating ? (_shakeController.value < 0.5 ? 1 : -1) : 0),
                              0),
                          child: child,
                        ),
                        child: Card(
                          elevation: 4,
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(24)),
                          child: Padding(
                            padding: const EdgeInsets.all(32),
                            child: Text(
                              _currentQuestion.display,
                              style: const TextStyle(
                                  fontSize: 48, fontWeight: FontWeight.bold),
                              textAlign: TextAlign.center,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 32),
                      if (_answered && _lastCorrect != null) ...[
                        AnimatedContainer(
                          duration: const Duration(milliseconds: 300),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: _lastCorrect!
                                ? AppTheme.correctColor.withOpacity(0.15)
                                : AppTheme.wrongColor.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            _lastCorrect! ? '✅ נכון!' : '❌ התשובה הנכונה: ${_currentQuestion.correctAnswer}',
                            style: TextStyle(
                              fontSize: 22,
                              fontWeight: FontWeight.bold,
                              color: _lastCorrect! ? AppTheme.correctColor : AppTheme.wrongColor,
                            ),
                          ),
                        ),
                        const SizedBox(height: 16),
                      ],
                      if (!_answered) ...[
                        SizedBox(
                          width: 180,
                          child: TextField(
                            controller: _controller,
                            focusNode: _focusNode,
                            keyboardType: TextInputType.number,
                            textAlign: TextAlign.center,
                            style: const TextStyle(fontSize: 32),
                            decoration: InputDecoration(
                              hintText: '?',
                              border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(16)),
                              filled: true,
                              fillColor: Colors.white,
                            ),
                            onSubmitted: (_) => _submitAnswer(),
                          ),
                        ),
                        const SizedBox(height: 20),
                        ElevatedButton(
                          onPressed: _submitAnswer,
                          child: const Text('בדוק תשובה'),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              const AdBannerWidget(),
            ],
          ),
          if (_showFlame)
            Container(
              color: Colors.black54,
              child: Center(
                child: FlameWidget(
                  onComplete: () {
                    setState(() => _showFlame = false);
                    _advance();
                  },
                ),
              ),
            ),
        ],
      ),
    );
  }
}
