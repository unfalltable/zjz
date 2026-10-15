import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:miova_app/state/store_model.dart';
import 'package:miova_app/ui/checkout.dart';
import 'package:miova_app/ui/store_scope.dart';

import 'test_support.dart';

Map<String, dynamic> variantCatalog() {
  final base =
      (catalogFixture['products'] as List).first as Map<String, dynamic>;
  final root = {
    ...base,
    'listingId': 'nova',
    'variantAttributes': {'Finish': 'Black'},
  };
  final child = {
    ...base,
    'id': 'nova-white',
    'listingId': 'nova',
    'priceCents': 15700,
    'variantAttributes': {'Finish': 'White'},
  };
  return {
    ...catalogFixture,
    'products': [
      {
        ...base,
        'variants': [root, child],
      },
    ],
    'destinations': {
      ...catalogFixture['destinations'] as Map,
      'CA': {'en': 'Canada', 'zh': '加拿大', 'es': 'Canadá'},
    },
  };
}

http.Response response(Map<String, dynamic> body, {int status = 200}) =>
    http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );

Future<StoreModel> mountCheckout(
  WidgetTester tester,
  Future<http.Response> Function(http.Request) shipping, {
  Future<http.Response> Function(http.Request)? order,
}) async {
  tester.view.physicalSize = const Size(1000, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final model = testModel(
    client: MockClient((request) async {
      if (request.url.path == '/api/v1/catalog') {
        return response(variantCatalog());
      }
      if (request.url.path == '/api/v1/shipping') return shipping(request);
      if (request.url.path == '/api/v1/orders' && order != null) {
        return order(request);
      }
      throw StateError('Unexpected request: ${request.url.path}');
    }),
  );
  addTearDown(model.dispose);
  await model.initialize();
  expect(model.error, isNull);
  model.quantity('nova-white', 1);
  await tester.pumpWidget(
    StoreScope(
      model: model,
      child: const MaterialApp(home: CheckoutScreen()),
    ),
  );
  await tester.pump();
  return model;
}

FilledButton saveButton(WidgetTester tester) =>
    tester.widget<FilledButton>(find.byKey(const ValueKey('checkout-save')));

Future<void> fillAddress(
  WidgetTester tester, {
  String email = 'sam.smith@example.com',
  String phone = '+1 (415) 555-0123',
}) async {
  final fields = {
    'email': email,
    'firstName': 'Sam',
    'lastName': 'Smith',
    'address': '123 Main Street',
    'city': 'San Francisco',
    'postal': '94107',
    'phone': phone,
  };
  for (final entry in fields.entries) {
    final field = find.byKey(ValueKey('checkout-${entry.key}'));
    await tester.ensureVisible(field);
    await tester.enterText(field, entry.value);
  }
  await tester.pump();
}

Future<void> tapSave(WidgetTester tester) async {
  final button = find.byKey(const ValueKey('checkout-save'));
  await tester.ensureVisible(button);
  await tester.tap(button);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'Child SKU displays its specifications and configured quote totals',
    (tester) async {
      await mountCheckout(tester, (request) async {
        expect(jsonDecode(request.url.queryParameters['items']!), [
          {'id': 'nova-white', 'quantity': 1},
        ]);
        return response(
          shippingFixture(
            subtotalCents: 16600,
            shippingCents: 2475,
            availableMethods: const ['express'],
          ),
        );
      });
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(
        find.textContaining('Nova Orb Speaker · Finish: White × 1'),
        findsOneWidget,
      );
      expect(find.text('Subtotal: US\$166.00'), findsOneWidget);
      expect(find.text('Shipping: US\$24.75'), findsOneWidget);
      expect(find.text('Total: US\$190.75'), findsOneWidget);
      final route = tester.widget<DropdownButton<String>>(
        find.descendant(
          of: find.byType(DropdownButtonFormField<String>).last,
          matching: find.byType(DropdownButton<String>),
        ),
      );
      expect(route.items!.map((item) => item.value), ['express']);
      expect(saveButton(tester).onPressed, isNotNull);
    },
  );

  testWidgets('Loading and no-route states block saving and offer retry', (
    tester,
  ) async {
    final pending = Completer<http.Response>();
    var calls = 0, orders = 0;
    await mountCheckout(
      tester,
      (_) async {
        calls += 1;
        if (calls == 1) return pending.future;
        return response(shippingFixture(subtotalCents: 15700));
      },
      order: (_) async {
        orders += 1;
        throw StateError('Saving must stay disabled');
      },
    );
    expect(find.text('Checking shipping options…'), findsOneWidget);
    expect(find.text('Total: —'), findsOneWidget);
    expect(saveButton(tester).onPressed, isNull);
    pending.complete(
      response(
        shippingFixture(subtotalCents: 15700, availableMethods: const []),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.text('No shipping options are available for this destination.'),
      findsOneWidget,
    );
    expect(find.text('Total: —'), findsOneWidget);
    expect(saveButton(tester).onPressed, isNull);
    expect(orders, 0);
    await tester.tap(find.byKey(const ValueKey('shipping-retry')));
    await tester.pumpAndSettle();
    expect(calls, 2);
    expect(saveButton(tester).onPressed, isNotNull);
  });

  testWidgets('Shipping errors block saving and retry recovers', (
    tester,
  ) async {
    var calls = 0;
    await mountCheckout(tester, (_) async {
      calls += 1;
      if (calls == 1) {
        return response({'ok': false, 'message': 'Offline'}, status: 503);
      }
      return response(
        shippingFixture(subtotalCents: 15700, shippingCents: 950),
      );
    });
    await tester.pumpAndSettle();
    expect(
      find.text('Shipping options could not be checked. Please try again.'),
      findsOneWidget,
    );
    expect(saveButton(tester).onPressed, isNull);
    expect(find.text('Subtotal: —'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('shipping-retry')));
    await tester.pumpAndSettle();
    expect(calls, 2);
    expect(find.text('Total: US\$166.50'), findsOneWidget);
    expect(saveButton(tester).onPressed, isNotNull);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Switching country ignores a late old-country response', (
    tester,
  ) async {
    final oldUS = Completer<http.Response>();
    final model = await mountCheckout(tester, (request) async {
      final country = request.url.queryParameters['country']!;
      if (country == 'US') return oldUS.future;
      return response(
        shippingFixture(
          country: 'CA',
          subtotalCents: 15700,
          shippingCents: 1250,
          availableMethods: const ['priority'],
        ),
      );
    });
    expect(saveButton(tester).onPressed, isNull);
    await tester.tap(find.text('United States'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Canada').last);
    await tester.pumpAndSettle();
    expect(model.destination, 'CA');
    expect(find.text('Total: US\$169.50'), findsOneWidget);
    oldUS.complete(
      response(shippingFixture(subtotalCents: 15700, shippingCents: 9999)),
    );
    await tester.pumpAndSettle();
    expect(find.text('Total: US\$169.50'), findsOneWidget);
    expect(find.text('Total: US\$256.99'), findsNothing);
    expect(saveButton(tester).onPressed, isNotNull);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Country changes clear displayed quotes and ignore late errors', (
    tester,
  ) async {
    final canada = Completer<http.Response>();
    var usCalls = 0;
    final model = await mountCheckout(tester, (request) async {
      if (request.url.queryParameters['country'] == 'CA') return canada.future;
      usCalls += 1;
      return response(
        shippingFixture(
          subtotalCents: 15700,
          shippingCents: usCalls == 1 ? 730 : 850,
        ),
      );
    });
    await tester.pumpAndSettle();
    expect(find.text('Total: US\$164.30'), findsOneWidget);
    model.setDestination('CA');
    await tester.pump();
    expect(find.text('Total: —'), findsOneWidget);
    expect(saveButton(tester).onPressed, isNull);
    model.setDestination('US');
    await tester.pumpAndSettle();
    expect(find.text('Total: US\$165.50'), findsOneWidget);
    canada.complete(
      response({'ok': false, 'message': 'Old failure'}, status: 503),
    );
    await tester.pumpAndSettle();
    expect(usCalls, 2);
    expect(find.text('Total: US\$165.50'), findsOneWidget);
    expect(
      find.text('Shipping options could not be checked. Please try again.'),
      findsNothing,
    );
    expect(saveButton(tester).onPressed, isNotNull);
  });

  testWidgets('Returning to a country ignores its earlier request generation', (
    tester,
  ) async {
    final firstUS = Completer<http.Response>();
    var usCalls = 0;
    final model = await mountCheckout(tester, (request) async {
      if (request.url.queryParameters['country'] == 'CA') {
        return response(
          shippingFixture(country: 'CA', availableMethods: const ['priority']),
        );
      }
      usCalls += 1;
      if (usCalls == 1) return firstUS.future;
      return response(
        shippingFixture(
          revision: 'b' * 64,
          availableMethods: const ['express'],
        ),
      );
    });
    model.setDestination('CA');
    await tester.pumpAndSettle();
    model.setDestination('US');
    await tester.pumpAndSettle();
    DropdownButton<String> selected() => tester.widget<DropdownButton<String>>(
      find.descendant(
        of: find.byType(DropdownButtonFormField<String>).last,
        matching: find.byType(DropdownButton<String>),
      ),
    );
    expect(selected().value, 'express');
    firstUS.complete(
      response(shippingFixture(availableMethods: const ['standard'])),
    );
    await tester.pumpAndSettle();
    expect(usCalls, 2);
    expect(selected().value, 'express');
    expect(saveButton(tester).onPressed, isNotNull);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'Bag changes invalidate quotes and discard old quantity responses',
    (tester) async {
      final twoItems = Completer<http.Response>();
      var calls = 0;
      final model = await mountCheckout(tester, (request) async {
        calls += 1;
        final items = jsonDecode(request.url.queryParameters['items']!) as List;
        if (items.single['quantity'] == 2) return twoItems.future;
        return response(
          shippingFixture(
            subtotalCents: 15700,
            shippingCents: calls == 1 ? 730 : 850,
          ),
        );
      });
      await tester.pumpAndSettle();
      model.quantity('nova-white', 2);
      await tester.pump();
      expect(find.text('Total: —'), findsOneWidget);
      expect(saveButton(tester).onPressed, isNull);
      model.quantity('nova-white', 1);
      await tester.pumpAndSettle();
      expect(find.text('Total: US\$165.50'), findsOneWidget);
      twoItems.complete(
        response(shippingFixture(subtotalCents: 31400, shippingCents: 1800)),
      );
      await tester.pumpAndSettle();
      expect(calls, 3);
      expect(find.text('Total: US\$165.50'), findsOneWidget);
      expect(find.text('Total: US\$332.00'), findsNothing);
      expect(saveButton(tester).onPressed, isNotNull);
    },
  );

  testWidgets(
    'Valid email and phone save child SKU with shippingRevision as unpaid draft',
    (tester) async {
      Map<String, dynamic>? posted;
      final model = await mountCheckout(
        tester,
        (_) async => response(
          shippingFixture(
            subtotalCents: 16600,
            shippingCents: 2475,
            availableMethods: const ['express'],
          ),
        ),
        order: (request) async {
          posted = jsonDecode(request.body) as Map<String, dynamic>;
          return response({
            'ok': true,
            'orderNumber': 'MW-CHILD',
            'totalCents': 19075,
            'paymentStatus': 'pending',
          });
        },
      );
      await tester.pumpAndSettle();
      await fillAddress(tester);
      await tapSave(tester);
      expect(posted, isNotNull);
      expect(posted!['email'], 'sam.smith@example.com');
      expect(posted!['phone'], '+1 (415) 555-0123');
      expect(posted!['destination'], 'US');
      expect(posted!['deliveryMethod'], 'express');
      expect(posted!['shippingRevision'], shippingRevisionFixture);
      expect(posted!['expectedSubtotalCents'], 16600);
      expect(posted!['expectedShippingCents'], 2475);
      expect(posted!['items'], [
        {'id': 'nova-white', 'quantity': 1},
      ]);
      expect(posted!['idempotencyKey'], isNotEmpty);
      expect(model.count, 0);
      expect(model.sku('nova-white')!.inventory, 2);
      expect(find.text('Order saved · payment pending'), findsOneWidget);
      expect(find.text('Total: US\$190.75'), findsOneWidget);
      expect(
        find.textContaining('no charge, stock reservation or shipping'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('Order error refresh preserves delivery choice and retry key', (
    tester,
  ) async {
    final posted = <Map<String, dynamic>>[];
    var shippingCalls = 0;
    final model = await mountCheckout(
      tester,
      (_) async {
        shippingCalls += 1;
        return response(
          shippingFixture(
            subtotalCents: 15700,
            availableMethods: const ['standard', 'express'],
          ),
        );
      },
      order: (request) async {
        posted.add(jsonDecode(request.body) as Map<String, dynamic>);
        if (posted.length == 1) {
          return response({
            'ok': false,
            'message': 'Try saving again',
          }, status: 503);
        }
        return response({
          'ok': true,
          'orderNumber': 'MW-RETRY',
          'totalCents': 16430,
        });
      },
    );
    await tester.pumpAndSettle();
    DropdownButton<String> selected() => tester.widget<DropdownButton<String>>(
      find.descendant(
        of: find.byType(DropdownButtonFormField<String>).last,
        matching: find.byType(DropdownButton<String>),
      ),
    );
    selected().onChanged!('express');
    await tester.pumpAndSettle();
    await fillAddress(tester);
    await tapSave(tester);
    expect(posted.length, 1);
    expect(shippingCalls, 2);
    expect(selected().value, 'express');
    expect(model.count, 1);
    expect(saveButton(tester).onPressed, isNotNull);
    await tapSave(tester);
    expect(posted.length, 2);
    expect(posted[0]['deliveryMethod'], 'express');
    expect(posted[1]['deliveryMethod'], 'express');
    expect(posted[1]['shippingRevision'], shippingRevisionFixture);
    expect(posted[0]['idempotencyKey'], posted[1]['idempotencyKey']);
    expect(model.count, 0);
    expect(find.textContaining('MW-RETRY'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Changed prices preserve the bag and require review before retry', (
    tester,
  ) async {
    final posted = <Map<String, dynamic>>[];
    var shippingCalls = 0;
    final model = await mountCheckout(
      tester,
      (_) async {
        shippingCalls += 1;
        return response(
          shippingFixture(
            subtotalCents: shippingCalls == 1 ? 15700 : 16600,
            shippingCents: shippingCalls == 1 ? 730 : 950,
          ),
        );
      },
      order: (request) async {
        posted.add(jsonDecode(request.body) as Map<String, dynamic>);
        if (posted.length == 1) {
          return response({
            'ok': false,
            'code': 'price_quote_changed',
            'message': 'Product prices changed. Review the new total.',
          }, status: 409);
        }
        return response({
          'ok': true,
          'orderNumber': 'MW-REVIEWED',
          'totalCents': 17550,
          'paymentStatus': 'pending',
        });
      },
    );
    await tester.pumpAndSettle();
    await fillAddress(tester);
    await tapSave(tester);
    expect(posted.length, 1);
    expect(posted.first['expectedSubtotalCents'], 15700);
    expect(posted.first['expectedShippingCents'], 730);
    expect(model.count, 1);
    expect(find.text('Total: US\$175.50'), findsOneWidget);
    expect(find.textContaining('Product prices changed'), findsOneWidget);
    await tapSave(tester);
    expect(posted.length, 2);
    expect(posted.last['expectedSubtotalCents'], 16600);
    expect(posted.last['expectedShippingCents'], 950);
    expect(posted.first['idempotencyKey'], isNot(posted.last['idempotencyKey']));
    expect(model.count, 0);
    expect(find.textContaining('MW-REVIEWED'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  for (final invalid in [
    {'email': 'sam @example.com', 'phone': '+1 415 555 0123'},
    {'email': 'sam@example', 'phone': '+1 415 555 0123'},
    {'email': 'sam@example.com', 'phone': 'abcdefghi'},
    {'email': 'sam@example.com', 'phone': '--- --- ---'},
    {'email': 'sam@example.com', 'phone': '+1 (23)'},
  ]) {
    testWidgets('Invalid contact data is not submitted: $invalid', (
      tester,
    ) async {
      var orders = 0;
      await mountCheckout(
        tester,
        (_) async => response(shippingFixture()),
        order: (_) async {
          orders += 1;
          throw StateError('Invalid form should not submit');
        },
      );
      await tester.pumpAndSettle();
      await fillAddress(
        tester,
        email: invalid['email']!,
        phone: invalid['phone']!,
      );
      await tapSave(tester);
      expect(orders, 0);
      expect(find.text('Please check this field'), findsWidgets);
      expect(tester.takeException(), isNull);
    });
  }
}
