import 'package:flutter/material.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';
import 'theme/app_theme.dart';
import 'screens/home_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await MobileAds.instance.initialize();
  runApp(const MathKidsApp());
}

class MathKidsApp extends StatelessWidget {
  const MathKidsApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'מתמטיקה כיפית',
      theme: AppTheme.theme,
      debugShowCheckedModeBanner: false,
      locale: const Locale('he', 'IL'),
      builder: (context, child) => Directionality(
        textDirection: TextDirection.rtl,
        child: child!,
      ),
      home: const HomeScreen(),
    );
  }
}
