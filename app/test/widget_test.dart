import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:miova_app/app.dart';

import 'test_support.dart';

void main() {
  for (final size in [
    const Size(375, 812),
    const Size(812, 375),
    const Size(1024, 768),
  ]) {
    testWidgets('Shopping flow fits ${size.width} × ${size.height}', (
      tester,
    ) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final model = testModel();
      await model.initialize();
      await tester.pumpWidget(MiovaApp(model: model));
      await tester.pumpAndSettle();
      expect(find.text('MIOVA 妙物'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.text('Nova Orb Speaker'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      expect(find.text('Nova Orb Speaker'), findsOneWidget);
      await tester.ensureVisible(find.text('Add to bag'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Add to bag'));
      await tester.pumpAndSettle();
      expect(model.count, 1);
      await tester.tap(find.text('Bag (1)'));
      await tester.pumpAndSettle();
      expect(find.text('Continue to checkout'), findsOneWidget);
      await tester.ensureVisible(find.text('Continue to checkout'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Continue to checkout'));
      await tester.pumpAndSettle();
      expect(find.text('Delivery details'), findsOneWidget);
      expect(find.textContaining('Online payment is not open'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }
  testWidgets(
    'Chinese, dark mode, reduced motion and 200% text remain usable',
    (tester) async {
      tester.view.physicalSize = const Size(375, 812);
      tester.view.devicePixelRatio = 1;
      tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      tester.platformDispatcher.accessibilityFeaturesTestValue =
          const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      addTearDown(
        tester.platformDispatcher.clearAccessibilityFeaturesTestValue,
      );
      final model = testModel();
      await model.initialize();
      model.setLocale('zh');
      await tester.pumpWidget(MiovaApp(model: model));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('加入购物袋'));
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
