import 'package:flutter/material.dart';
import '../models/game_session.dart';
import '../widgets/ad_banner_widget.dart';
import '../theme/app_theme.dart';

class ResultsScreen extends StatelessWidget {
  final GameSession session;
  final int runCount;

  const ResultsScreen({super.key, required this.session, required this.runCount});

  @override
  Widget build(BuildContext context) {
    final percent = (session.correctCount / session.totalQuestions * 100).round();
    final emoji = percent == 100 ? '🏆' : percent >= 80 ? '⭐' : percent >= 60 ? '👍' : '💪';

    return Scaffold(
      appBar: AppBar(title: const Text('תוצאות')),
      body: Column(
        children: [
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Column(
                children: [
                  Text(emoji, style: const TextStyle(fontSize: 80)),
                  const SizedBox(height: 16),
                  Text('$percent%',
                      style: const TextStyle(
                          fontSize: 64, fontWeight: FontWeight.bold,
                          color: AppTheme.primaryDark)),
                  Text('${session.correctCount} מתוך ${session.totalQuestions} נכונות',
                      style: const TextStyle(fontSize: 20, color: Colors.grey)),
                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.star, color: AppTheme.accent),
                      const SizedBox(width: 6),
                      Text('${session.totalScore} נקודות',
                          style: const TextStyle(
                              fontSize: 24, fontWeight: FontWeight.bold)),
                    ],
                  ),
                  if (runCount >= 10)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Text(
                        '🎯 אחרי ${runCount} ריצות זוהו לך תרגילים לתרגול מיוחד!',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                            fontSize: 16, color: AppTheme.accent,
                            fontWeight: FontWeight.bold),
                      ),
                    ),
                  const SizedBox(height: 24),
                  const Divider(),
                  const SizedBox(height: 8),
                  ...session.results.map((r) => ListTile(
                        leading: Icon(
                          r.isCorrect ? Icons.check_circle : Icons.cancel,
                          color: r.isCorrect ? AppTheme.correctColor : AppTheme.wrongColor,
                        ),
                        title: Text(
                          '${r.question.display.replaceAll('?', '')}${r.userAnswer}',
                          style: const TextStyle(fontSize: 18),
                        ),
                        trailing: r.isCorrect
                            ? Text('+${r.points}',
                                style: const TextStyle(
                                    color: AppTheme.correctColor,
                                    fontWeight: FontWeight.bold))
                            : Text('✗ ${r.question.correctAnswer}',
                                style: const TextStyle(color: AppTheme.wrongColor)),
                      )),
                  const SizedBox(height: 24),
                  ElevatedButton(
                    onPressed: () =>
                        Navigator.popUntil(context, (r) => r.isFirst),
                    child: const Text('חזור לתפריט הראשי'),
                  ),
                ],
              ),
            ),
          ),
          const AdBannerWidget(),
        ],
      ),
    );
  }
}
