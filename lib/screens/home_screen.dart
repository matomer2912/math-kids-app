import 'package:flutter/material.dart';
import '../models/question.dart';
import '../services/storage_service.dart';
import '../widgets/ad_banner_widget.dart';
import '../theme/app_theme.dart';
import 'game_screen.dart';
import 'high_scores_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _storage = StorageService();

  final Map<Operation, bool> _selectedOps = {
    Operation.addition: true,
    Operation.subtraction: false,
    Operation.multiplication: false,
    Operation.division: false,
  };
  int _questionCount = 10;
  int _maxNumber = 50;
  int _runCount = 0;
  bool _hardMode = false;
  List<String> _hardQuestions = [];

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  Future<void> _loadStats() async {
    final runs = await _storage.getRunCount();
    final hard = await _storage.getHardQuestions();
    setState(() {
      _runCount = runs;
      _hardQuestions = hard;
    });
  }

  List<Operation> get _activeOps =>
      _selectedOps.entries.where((e) => e.value).map((e) => e.key).toList();

  void _startGame() {
    if (_activeOps.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('בחרי לפחות פעולה אחת')),
      );
      return;
    }
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => GameScreen(
          operations: _activeOps,
          questionCount: _questionCount,
          maxNumber: _maxNumber,
          hardQuestionKeys: _hardMode ? _hardQuestions : null,
        ),
      ),
    ).then((_) => _loadStats());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('מתמטיקה כיפית 🎉'),
        actions: [
          IconButton(
            icon: const Icon(Icons.emoji_events),
            tooltip: 'שיאים',
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const HighScoresScreen()),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _SectionCard(
                    title: 'בחר פעולות חשבון',
                    child: Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      children: Operation.values.map((op) {
                        final selected = _selectedOps[op]!;
                        return FilterChip(
                          label: Text('${op.symbol} ${op.hebrewName}',
                              style: const TextStyle(fontSize: 16)),
                          selected: selected,
                          selectedColor: AppTheme.primary.withOpacity(0.3),
                          checkmarkColor: AppTheme.primaryDark,
                          onSelected: (val) =>
                              setState(() => _selectedOps[op] = val),
                        );
                      }).toList(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  _SectionCard(
                    title: 'מספר שאלות',
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [5, 10, 20].map((n) {
                        final selected = _questionCount == n;
                        return _ChoiceButton(
                          label: '$n',
                          selected: selected,
                          onTap: () => setState(() => _questionCount = n),
                        );
                      }).toList(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  _SectionCard(
                    title: 'גובה המספרים',
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [
                        _ChoiceButton(
                          label: 'עד 50\nקל',
                          selected: _maxNumber == 50,
                          onTap: () => setState(() => _maxNumber = 50),
                        ),
                        _ChoiceButton(
                          label: 'עד 100\nבינוני',
                          selected: _maxNumber == 100,
                          onTap: () => setState(() => _maxNumber = 100),
                        ),
                        _ChoiceButton(
                          label: 'עד 200\nקשה',
                          selected: _maxNumber == 200,
                          onTap: () => setState(() => _maxNumber = 200),
                        ),
                      ],
                    ),
                  ),
                  if (_runCount >= 10 && _hardQuestions.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    _SectionCard(
                      title: '🎯 מצב תרגול מיוחד',
                      child: SwitchListTile(
                        title: const Text('תרגל את התרגילים הקשים שלך',
                            style: TextStyle(fontSize: 16)),
                        subtitle: Text(
                            'זוהו ${_hardQuestions.length} תרגילים שצריכים תרגול'),
                        value: _hardMode,
                        activeColor: AppTheme.accent,
                        onChanged: (val) => setState(() => _hardMode = val),
                      ),
                    ),
                  ],
                  const SizedBox(height: 28),
                  ElevatedButton(
                    onPressed: _startGame,
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 18),
                      textStyle: const TextStyle(fontSize: 22),
                    ),
                    child: const Text('🚀 התחל משחק!'),
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

class _SectionCard extends StatelessWidget {
  final String title;
  final Widget child;

  const _SectionCard({required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title,
                style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.primaryDark)),
            const SizedBox(height: 12),
            child,
          ],
        ),
      ),
    );
  }
}

class _ChoiceButton extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _ChoiceButton(
      {required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        decoration: BoxDecoration(
          color: selected ? AppTheme.primary : Colors.grey[200],
          borderRadius: BorderRadius.circular(12),
          boxShadow: selected
              ? [BoxShadow(color: AppTheme.primary.withOpacity(0.4), blurRadius: 8)]
              : [],
        ),
        child: Text(
          label,
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.bold,
            color: selected ? Colors.white : Colors.black87,
          ),
        ),
      ),
    );
  }
}
