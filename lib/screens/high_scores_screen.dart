import 'package:flutter/material.dart';
import '../services/storage_service.dart';
import '../widgets/ad_banner_widget.dart';
import '../theme/app_theme.dart';

class HighScoresScreen extends StatefulWidget {
  const HighScoresScreen({super.key});

  @override
  State<HighScoresScreen> createState() => _HighScoresScreenState();
}

class _HighScoresScreenState extends State<HighScoresScreen> {
  final _storage = StorageService();
  Map<String, int> _scores = {};
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final scores = await _storage.getHighScores();
    setState(() {
      _scores = scores;
      _loading = false;
    });
  }

  String _formatKey(String key) {
    final parts = key.split('_');
    if (parts.length < 2) return key;
    final ops = parts.first.split('-').map((o) {
      switch (o) {
        case 'addition': return 'חיבור';
        case 'subtraction': return 'חיסור';
        case 'multiplication': return 'כפל';
        case 'division': return 'חילוק';
        default: return o;
      }
    }).join(', ');
    return '$ops | עד ${parts.last}';
  }

  @override
  Widget build(BuildContext context) {
    final sorted = _scores.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));

    return Scaffold(
      appBar: AppBar(title: const Text('🏆 שיאים')),
      body: Column(
        children: [
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : sorted.isEmpty
                    ? const Center(
                        child: Text('עדיין אין שיאים.\nשחק משחק ראשון!',
                            textAlign: TextAlign.center,
                            style: TextStyle(fontSize: 20, color: Colors.grey)))
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: sorted.length,
                        itemBuilder: (_, i) {
                          final medal = i == 0 ? '🥇' : i == 1 ? '🥈' : i == 2 ? '🥉' : '  ';
                          return Card(
                            margin: const EdgeInsets.symmetric(vertical: 6),
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12)),
                            child: ListTile(
                              leading: Text(medal,
                                  style: const TextStyle(fontSize: 28)),
                              title: Text(_formatKey(sorted[i].key),
                                  style: const TextStyle(fontSize: 16)),
                              trailing: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(Icons.star,
                                      color: AppTheme.accent, size: 20),
                                  const SizedBox(width: 4),
                                  Text('${sorted[i].value}',
                                      style: const TextStyle(
                                          fontSize: 20,
                                          fontWeight: FontWeight.bold)),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
          ),
          const AdBannerWidget(),
        ],
      ),
    );
  }
}
