import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:miova_app/state/store_model.dart';
import 'package:miova_app/ui/shop.dart';
import 'package:miova_app/ui/store_scope.dart';

import 'test_support.dart';

// Match the API's listing + flat root/child SKU grouping, rather than treating
// children as separate listings. The cheapest root SKU starts out sold out.
Map<String, dynamic> groupedCatalog({
  int rootInventory = 0,
  bool includeRed = true,
  bool grouped = true,
}) {
  final base = Map<String, dynamic>.from(
    (catalogFixture['products'] as List).single as Map,
  );
  final root = {
    ...base,
    'priceCents': 1000,
    'inventory': rootInventory,
    'listingId': 'nova',
    'sku': 'NOVA-BASE',
    'variantAttributes': {'Color': 'Original'},
  };
  return {
    ...catalogFixture,
    'products': [
      {
        ...root,
        if (grouped)
          'variants': [
            root,
            if (includeRed)
              {
                ...base,
                'id': 'nova-red',
                'listingId': 'nova',
                'sku': 'NOVA-RED',
                'priceCents': 2500,
                'inventory': 2,
                'variantAttributes': {'Color': 'Red'},
              },
            {
              ...base,
              'id': 'nova-blue',
              'listingId': 'nova',
              'sku': 'NOVA-BLUE',
              'priceCents': 2000,
              'inventory': 1,
              'variantAttributes': {'Color': 'Blue'},
            },
          ],
      },
    ],
  };
}

http.Response groupedResponse(Map<String, dynamic> fixture) => http.Response(
  jsonEncode(fixture),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

StoreModel variantModel({MemoryDrafts? drafts}) => testModel(
  drafts: drafts,
  client: MockClient((_) async => groupedResponse(groupedCatalog())),
);

Future<void> openShop(
  WidgetTester tester,
  StoreModel model, {
  String path = '/',
}) async {
  final router = GoRouter(
    initialLocation: path,
    routes: [
      GoRoute(
        path: '/',
        builder: (_, _) => const Scaffold(body: ShopScreen()),
      ),
      GoRoute(
        path: '/product/:id',
        builder: (_, state) => ProductScreen(id: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/bag',
        builder: (_, _) => const Scaffold(body: BagScreen()),
      ),
    ],
  );
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox.shrink());
    router.dispose();
    model.dispose();
  });
  await tester.pumpWidget(
    MaterialApp.router(
      routerConfig: router,
      builder: (_, child) => StoreScope(model: model, child: child!),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> reveal(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(
    finder,
    150,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.pumpAndSettle();
}

Future<void> tapVisible(WidgetTester tester, Finder finder) async {
  await reveal(tester, finder);
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

FilledButton addButton(WidgetTester tester) =>
    tester.widget<FilledButton>(find.byKey(const ValueKey('product-add')));

void main() {
  testWidgets(
    'Sold-out root lists available child starting price and selects before adding',
    (tester) async {
      final model = variantModel();
      await model.initialize();
      await openShop(tester, model);
      await reveal(tester, find.byType(ProductCard));
      expect(find.text(r'From US$20.00'), findsOneWidget);
      expect(find.text('Stock: 3'), findsOneWidget);
      final choose = find.widgetWithText(FilledButton, 'Choose options');
      expect(tester.widget<FilledButton>(choose).onPressed, isNotNull);
      await tapVisible(tester, choose);
      expect(find.byType(ProductScreen), findsOneWidget);
      expect(model.bag, isEmpty);
      await reveal(tester, find.byKey(const ValueKey('product-add')));
      expect(addButton(tester).onPressed, isNull);
      await tapVisible(
        tester,
        find.byKey(const ValueKey('variant-nova-red')),
      );
      expect(find.text(r'US$25.00'), findsOneWidget);
      expect(find.text('Stock: 2'), findsOneWidget);
      expect(find.text('Color: Red'), findsOneWidget);
      await tapVisible(tester, find.byKey(const ValueKey('product-add')));
      expect(model.bag, {'nova-red': 1});
      expect(find.byType(BagScreen), findsOneWidget);
      expect(find.text('Color: Red'), findsOneWidget);
      expect(find.text(r'US$25.00'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Child deep link selects its SKU and options use distinct prices and stock',
    (tester) async {
      final model = variantModel();
      await model.initialize();
      model.quantity('nova-blue', 1);
      await openShop(tester, model, path: '/product/nova-red');
      await reveal(tester, find.byKey(const ValueKey('variant-nova-red')));
      expect(
        tester.widget<ChoiceChip>(
          find.byKey(const ValueKey('variant-nova-red')),
        ).selected,
        isTrue,
      );
      expect(find.text('This product is no longer available'), findsNothing);
      expect(find.text(r'US$25.00'), findsOneWidget);
      expect(find.text('Stock: 2'), findsOneWidget);
      await reveal(tester, find.byKey(const ValueKey('product-add')));
      expect(addButton(tester).onPressed, isNotNull);
      await tapVisible(
        tester,
        find.byKey(const ValueKey('variant-nova-blue')),
      );
      expect(find.text(r'US$20.00'), findsOneWidget);
      expect(find.text('Stock: 1'), findsOneWidget);
      expect(find.text('Color: Blue'), findsOneWidget);
      await reveal(tester, find.byKey(const ValueKey('product-add')));
      expect(addButton(tester).onPressed, isNull);
      await tapVisible(tester, find.byKey(const ValueKey('variant-nova')));
      expect(find.text(r'US$10.00'), findsOneWidget);
      expect(find.text('Stock: 0'), findsOneWidget);
      await reveal(tester, find.byKey(const ValueKey('product-add')));
      expect(addButton(tester).onPressed, isNull);
      expect(find.widgetWithText(FilledButton, 'Out of stock'), findsOneWidget);
      expect(model.bag, {'nova-blue': 1});
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Restored child bag renders attributes and safely increases decreases removes',
    (tester) async {
      final drafts = MemoryDrafts()
        ..value = jsonEncode({
          'locale': 'en',
          'destination': 'US',
          'bag': {'nova-red': 1},
          'favorites': [],
        });
      final model = variantModel(drafts: drafts);
      await model.initialize();
      expect(model.product('nova-red'), isNull);
      expect(model.bag, {'nova-red': 1});
      await openShop(tester, model, path: '/bag');
      expect(find.text('Color: Red'), findsOneWidget);
      expect(find.text(r'US$25.00'), findsOneWidget);
      await tapVisible(tester, find.byTooltip('Increase quantity'));
      expect(model.bag, {'nova-red': 2});
      expect(find.text(r'US$50.00'), findsOneWidget);
      expect(
        tester.widget<IconButton>(
          find.widgetWithIcon(IconButton, Icons.add),
        ).onPressed,
        isNull,
      );
      await tapVisible(tester, find.byTooltip('Decrease quantity'));
      expect(model.bag, {'nova-red': 1});
      expect(find.text(r'US$25.00'), findsOneWidget);
      await tapVisible(tester, find.byTooltip('Remove item'));
      expect(model.bag, isEmpty);
      expect(find.text('Nothing here yet'), findsOneWidget);
      expect(jsonDecode(drafts.value!)['bag'], isEmpty);
      expect(tester.takeException(), isNull);
    },
  );

  for (final grouped in [true, false]) {
    testWidgets(
      'Refresh removing selected child keeps add disabled (grouped: $grouped)',
      (tester) async {
        var fixture = groupedCatalog();
        final model = testModel(
          client: MockClient((_) async => groupedResponse(fixture)),
        );
        await model.initialize();
        await openShop(tester, model, path: '/product/nova-red');
        await reveal(tester, find.byKey(const ValueKey('product-add')));
        expect(addButton(tester).onPressed, isNotNull);
        fixture = groupedCatalog(
          includeRed: false,
          rootInventory: 3,
          grouped: grouped,
        );
        await model.reload();
        await tester.pumpAndSettle();
        await reveal(tester, find.byKey(const ValueKey('product-add')));
        expect(
          find.text(
            'This option is no longer available. Please choose another option.',
          ),
          findsOneWidget,
        );
        expect(addButton(tester).onPressed, isNull);
        for (final chip in tester.widgetList<ChoiceChip>(find.byType(ChoiceChip))) {
          expect(chip.selected, isFalse);
        }
        await tester.tap(find.byKey(const ValueKey('product-add')));
        await tester.pumpAndSettle();
        expect(model.bag, isEmpty);
        await tapVisible(tester, find.byKey(const ValueKey('variant-nova')));
        await tapVisible(tester, find.byKey(const ValueKey('product-add')));
        expect(model.bag, {'nova': 1});
        expect(find.byType(BagScreen), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('Bag safely ignores SKU IDs missing from the current catalog', (
    tester,
  ) async {
    final model = variantModel();
    await model.initialize();
    model.bag['removed-child'] = 1;
    await openShop(tester, model, path: '/bag');
    expect(find.text('Nothing here yet'), findsOneWidget);
    expect(find.text('Continue to checkout'), findsNothing);
    expect(tester.takeException(), isNull);
    model.quantity('nova-red', 1);
    await tester.pumpAndSettle();
    expect(find.text('Color: Red'), findsOneWidget);
    expect(find.text(r'US$25.00'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
