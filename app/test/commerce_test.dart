import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:miova_app/data/commerce_api.dart';
import 'package:miova_app/state/store_model.dart';

import 'test_support.dart';

void main() {
  test(
    'Checkout retry key survives restart without storing personal fields',
    () async {
      final drafts = MemoryDrafts();
      final model = testModel(drafts: drafts);
      await model.initialize();
      final input = <String, dynamic>{
        'email': 'person@example.com',
        'address': 'Private address',
        'items': [
          {'id': 'nova', 'quantity': 1},
        ],
      };
      final key = await model.checkoutKeyFor(input);
      expect(drafts.value, isNot(contains('person@example.com')));
      expect(drafts.value, isNot(contains('Private address')));
      final restored = testModel(drafts: drafts);
      await restored.initialize();
      expect(await restored.checkoutKeyFor(input), key);
      expect(
        await restored.checkoutKeyFor({
          ...input,
          'address': 'Different address',
        }),
        isNot(key),
      );
      model.dispose();
      restored.dispose();
    },
  );
  test(
    'Server catalog drives price and stock limits; preferences survive restart',
    () async {
      final drafts = MemoryDrafts();
      final model = testModel(drafts: drafts);
      await model.initialize();
      expect(model.error, isNull);
      model.quantity('nova', 9);
      expect(model.count, 2);
      expect(model.subtotal, 25800);
      model.toggleFavorite('nova');
      model.setLocale('zh');
      await Future<void>.delayed(Duration.zero);
      final restored = testModel(drafts: drafts);
      await restored.initialize();
      expect(restored.count, 2);
      expect(restored.locale, 'zh');
      expect(restored.favorites, contains('nova'));
      restored.quantity('nova', 0);
      expect(restored.count, 0);
      model.dispose();
      restored.dispose();
    },
  );
  test('Idempotency key is UUID v4', () {
    final first = newIdempotencyKey();
    expect(
      first,
      matches(
        RegExp(
          r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
        ),
      ),
    );
    expect(newIdempotencyKey(), isNot(first));
  });
  test(
    'API posts checkout body and never accepts failed response as order',
    () async {
      final api = CommerceApi(
        baseUrl: Uri.parse('https://store.example'),
        client: MockClient((request) async {
          expect(request.method, 'POST');
          expect(request.url.path, '/api/v1/orders');
          expect(jsonDecode(request.body)['idempotencyKey'], 'test-key');
          return http.Response(
            jsonEncode({
              'ok': true,
              'orderNumber': 'MW-123456',
              'totalCents': 12900,
              'paymentStatus': 'pending',
            }),
            200,
          );
        }),
      );
      expect(
        (await api.createOrder({'idempotencyKey': 'test-key'})).orderNumber,
        'MW-123456',
      );
      api.close();
      final denied = CommerceApi(
        baseUrl: Uri.parse('https://store.example'),
        client: MockClient(
          (_) async =>
              http.Response('{"ok":false,"message":"Invalid address"}', 422),
        ),
      );
      await expectLater(denied.createOrder({}), throwsA(isA<ApiException>()));
      denied.close();
    },
  );
}
