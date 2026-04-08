import 'package:flutter/material.dart';

class AppTheme {
  static const Color primary = Color(0xFF4CAF50);
  static const Color primaryDark = Color(0xFF388E3C);
  static const Color accent = Color(0xFFFF9800);
  static const Color background = Color(0xFFF1F8E9);
  static const Color cardColor = Colors.white;
  static const Color correctColor = Color(0xFF4CAF50);
  static const Color wrongColor = Color(0xFFF44336);

  static ThemeData get theme => ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: primary,
          surface: background,
        ),
        scaffoldBackgroundColor: background,
        fontFamily: 'Roboto',
        appBarTheme: const AppBarTheme(
          backgroundColor: primary,
          foregroundColor: Colors.white,
          centerTitle: true,
          elevation: 0,
        ),
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: primary,
            foregroundColor: Colors.white,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
            textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
        ),
      );
}
