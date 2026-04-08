import 'package:flutter/material.dart';

class FlameWidget extends StatefulWidget {
  final VoidCallback? onComplete;

  const FlameWidget({super.key, this.onComplete});

  @override
  State<FlameWidget> createState() => _FlameWidgetState();
}

class _FlameWidgetState extends State<FlameWidget>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnim;
  late Animation<double> _opacityAnim;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    );
    _scaleAnim = TweenSequence([
      TweenSequenceItem(tween: Tween(begin: 0.0, end: 1.3), weight: 40),
      TweenSequenceItem(tween: Tween(begin: 1.3, end: 1.0), weight: 20),
      TweenSequenceItem(tween: Tween(begin: 1.0, end: 1.0), weight: 20),
      TweenSequenceItem(tween: Tween(begin: 1.0, end: 0.0), weight: 20),
    ]).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));
    _opacityAnim = TweenSequence([
      TweenSequenceItem(tween: Tween(begin: 0.0, end: 1.0), weight: 20),
      TweenSequenceItem(tween: Tween(begin: 1.0, end: 1.0), weight: 60),
      TweenSequenceItem(tween: Tween(begin: 1.0, end: 0.0), weight: 20),
    ]).animate(_controller);

    _controller.forward().then((_) => widget.onComplete?.call());
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (_, __) => Opacity(
        opacity: _opacityAnim.value,
        child: Transform.scale(
          scale: _scaleAnim.value,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('🔥🔥🔥', style: TextStyle(fontSize: 64)),
              const SizedBox(height: 8),
              Text(
                'מדהים! 5 ברצף!',
                style: TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.bold,
                  color: Colors.orange[700],
                  shadows: const [
                    Shadow(color: Colors.orange, blurRadius: 8),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
