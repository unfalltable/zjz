import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:miova_app/app.dart';
import 'package:miova_app/l10n/strings.dart';
import 'package:miova_app/state/store_model.dart';
import 'package:miova_app/ui/shop.dart';
import 'package:miova_app/ui/store_scope.dart';
import 'package:miova_app/ui/theme.dart';

import 'test_support.dart';

http.Response catalogResponse({bool empty = false}) => http.Response(
  jsonEncode({...catalogFixture, if (empty) 'products': []}),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

Widget detailApp(StoreModel model, String id) => MaterialApp(
  theme: miovaTheme(Brightness.light),
  darkTheme: miovaTheme(Brightness.dark),
  home: StoreScope(
    model: model,
    child: ProductScreen(id: id),
  ),
);

void main() {
  for (final size in [const Size(375, 812), const Size(812, 375)]) {
    for (final failed in [false, true]) {
      testWidgets(
        'Product ${failed ? 'network error' : 'unavailable'} at $size supports dark mode and 200% text',
        (tester) async {
          tester.view.physicalSize = size;
          tester.view.devicePixelRatio = 1;
          tester.platformDispatcher.platformBrightnessTestValue =
              Brightness.dark;
          tester.platformDispatcher.textScaleFactorTestValue = 2;
          tester.platformDispatcher.accessibilityFeaturesTestValue =
              const FakeAccessibilityFeatures(disableAnimations: true);
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          addTearDown(
            tester.platformDispatcher.clearPlatformBrightnessTestValue,
          );
          addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
          addTearDown(
            tester.platformDispatcher.clearAccessibilityFeaturesTestValue,
          );
          final model = testModel(
            client: failed
                ? MockClient(
                    (_) async =>
                        http.Response('{"ok":false,"message":"Offline"}', 503),
                  )
                : null,
          );
          await model.initialize();
          await tester.pumpWidget(detailApp(model, 'missing'));
          await tester.pumpAndSettle();
          expect(
            find.text(
              failed
                  ? Copy('en').t('unavailable')
                  : Copy('en').t('productUnavailable'),
            ),
            findsOneWidget,
          );
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox.shrink());
          model.dispose();
        },
      );
    }
  }

  testWidgets(
    'Product deep link waits for catalog instead of flashing unavailable',
    (tester) async {
      final response = Completer<http.Response>();
      final model = testModel(client: MockClient((_) => response.future));
      final initialized = model.initialize();
      await tester.pumpWidget(detailApp(model, 'nova'));
      expect(find.text('Loading current products…'), findsOneWidget);
      expect(find.text('This product is no longer available'), findsNothing);
      response.complete(catalogResponse());
      await initialized;
      await tester.pumpAndSettle();
      expect(find.text('Nova Orb Speaker'), findsNWidgets(2));
      expect(find.text('This product is no longer available'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      model.dispose();
    },
  );

  testWidgets(
    'Unavailable product is shown only after a successful catalog read',
    (tester) async {
      final model = testModel();
      await model.initialize();
      await tester.pumpWidget(detailApp(model, 'not-a-product'));
      await tester.pumpAndSettle();
      expect(find.text('This product is no longer available'), findsOneWidget);
      expect(find.text('Loading current products…'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      model.dispose();
    },
  );

  testWidgets(
    'Product catalog failure offers retry, not a false product-not-found message',
    (tester) async {
      var attempts = 0;
      final model = testModel(
        client: MockClient((_) async {
          attempts += 1;
          return attempts == 1
              ? http.Response('{"ok":false,"message":"Offline"}', 503)
              : catalogResponse();
        }),
      );
      await model.initialize();
      await tester.pumpWidget(detailApp(model, 'nova'));
      expect(find.text('The store is unavailable'), findsOneWidget);
      expect(find.text('This product is no longer available'), findsNothing);
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(attempts, 2);
      expect(find.text('Nova Orb Speaker'), findsNWidgets(2));
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      model.dispose();
    },
  );

  for (final locale in ['en', 'zh', 'es']) {
    testWidgets(
      '$locale empty catalog explains availability and offers retry',
      (tester) async {
        final model = testModel(
          client: MockClient((_) async => catalogResponse(empty: true)),
        );
        await model.initialize();
        model.setLocale(locale);
        await tester.pumpWidget(MiovaApp(model: model));
        await tester.pumpAndSettle();
        expect(find.text(Copy(locale).t('catalogEmpty')), findsOneWidget);
        await tester.ensureVisible(find.text(Copy(locale).t('retry')));
        expect(find.text(Copy(locale).t('retry')), findsOneWidget);
        expect(find.byType(ProductCard), findsNothing);
        expect(model.count, 0);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }

  testWidgets(
    'Failed refresh disables stale product purchasing while preserving a retry path',
    (tester) async {
      var attempts = 0;
      final model = testModel(
        client: MockClient((_) async {
          attempts += 1;
          return attempts == 1
              ? catalogResponse()
              : http.Response('{"ok":false,"message":"Offline"}', 503);
        }),
      );
      await model.initialize();
      await model.reload();
      await tester.pumpWidget(MiovaApp(model: model));
      await tester.pumpAndSettle();
      expect(find.text(Copy('en').t('unavailableBody')), findsOneWidget);
      await tester.scrollUntilVisible(
        find.text('Add to bag'),
        150,
        scrollable: find.byType(Scrollable).first,
      );
      final add = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Add to bag'),
      );
      expect(add.onPressed, isNull);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  test(
    'Latest catalog reload wins when network responses finish out of order',
    () async {
      final first = Completer<http.Response>();
      final second = Completer<http.Response>();
      var attempts = 0;
      final model = testModel(
        client: MockClient((_) {
          attempts += 1;
          return attempts == 1 ? first.future : second.future;
        }),
      );
      final older = model.reload();
      final newer = model.reload();
      second.complete(catalogResponse(empty: true));
      await newer;
      expect(model.catalog!.products, isEmpty);
      first.complete(catalogResponse());
      await older;
      expect(model.catalog!.products, isEmpty);
      expect(model.loading, isFalse);
      model.dispose();
    },
  );

  test(
    'Relative product assets and absolute HTTPS images resolve correctly',
    () {
      final model = testModel();
      expect(
        model.api.uri('/products/nova.webp').toString(),
        'https://store.example/products/nova.webp',
      );
      expect(
        model.api.uri('https://cdn.example/item.webp').toString(),
        'https://cdn.example/item.webp',
      );
      model.dispose();
    },
  );

  test('Payment and tax notices are explicit in every supported locale', () {
    for (final locale in ['en', 'zh', 'es']) {
      final copy = Copy(locale);
      expect(copy.t('paymentNotice'), isNot('paymentNotice'));
      expect(copy.t('taxNotEstimated'), isNot('taxNotEstimated'));
      expect(copy.t('taxNotEstimated'), isNot(contains('0.00')));
    }
    expect(Copy('en').t('paymentNotice'), contains('stock reservation'));
    expect(Copy('zh').t('paymentNotice'), contains('不锁库存'));
    expect(Copy('es').t('paymentNotice'), contains('reserva de existencias'));
  });
}
