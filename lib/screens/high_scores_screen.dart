import 'package:flutter/material.dart';
import '../constants/strings.dart';
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
    if (parts.length < 2) { return key; }
    final ops = parts.first
        .split('-')
        .map((o) => S.opNames[o] ?? o)
        .join(', ');
    return '$ops | ${S.upTo(int.tryParse(parts.last) ?? 0)}';
  }

  @override
  Widget build(BuildContext context) {
    final sorted = _scores.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));

    return Scaffold(
      appBar: AppBar(title: const Text(S.highScoresTitle)),
      body: Column(
        children: [
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : sorted.isEmpty
                    ? const Center(
                        child: Text(S.noScoresYet,
                            textAlign: TextAlign.center,
                            style: TextStyle(
                                fontSize: 20, color: Colors.grey)))
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: sorted.length,
                        itemBuilder: (_, i) {
                          final medal = i == 0
                              ? '\ud83e\udd47'
                              : i == 1
                                  ? '\ud83e\udd48'
                                  : i == 2
                                      ? '\ud83e\udd49'
                                      : '  ';
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
