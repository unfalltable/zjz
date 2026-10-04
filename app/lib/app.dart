import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:go_router/go_router.dart';

import 'state/store_model.dart';
import 'ui/checkout.dart';
import 'ui/shop.dart';
import 'ui/store_scope.dart';
import 'ui/theme.dart';
import 'ui/tracking.dart';

class MiovaApp extends StatefulWidget {
  const MiovaApp({super.key, required this.model});
  final StoreModel model;
  @override
  State<MiovaApp> createState() => _MiovaAppState();
}

class _MiovaAppState extends State<MiovaApp> {
  late final GoRouter _router = GoRouter(
    routes: [
      ShellRoute(
        builder: (context, state, child) =>
            StoreShell(path: state.uri.path, child: child),
        routes: [
          GoRoute(path: '/', builder: (_, _) => const ShopScreen()),
          GoRoute(
            path: '/saved',
            builder: (_, _) => const ShopScreen(savedOnly: true),
          ),
          GoRoute(path: '/bag', builder: (_, _) => const BagScreen()),
          GoRoute(path: '/track', builder: (_, _) => const TrackingScreen()),
        ],
      ),
      GoRoute(
        path: '/product/:id',
        builder: (_, state) => ProductScreen(id: state.pathParameters['id']!),
      ),
      GoRoute(path: '/checkout', builder: (_, _) => const CheckoutScreen()),
    ],
  );
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.model,
    builder: (context, _) => MaterialApp.router(
      title: 'MIOVA 妙物',
      debugShowCheckedModeBanner: false,
      routerConfig: _router,
      theme: miovaTheme(Brightness.light),
      darkTheme: miovaTheme(Brightness.dark),
      locale: Locale(widget.model.locale),
      supportedLocales: const [Locale('en'), Locale('zh'), Locale('es')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      builder: (_, child) => StoreScope(model: widget.model, child: child!),
    ),
  );
  @override
  void dispose() {
    _router.dispose();
    widget.model.dispose();
    super.dispose();
  }
}
