import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:miova_app/data/commerce_api.dart';

import 'test_support.dart';

http.Response response(Map<String, dynamic> body, {int status = 200}) =>
    http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );

CommerceApi apiFor(Future<http.Response> Function(http.Request) handler) {
  final api = CommerceApi(
    baseUrl: Uri.parse('https://store.example'),
    client: MockClient(handler),
  );
  addTearDown(api.close);
  return api;
}

void main() {
  test(
    'Shipping GET encodes child SKUs and uses configured server amounts',
    () async {
      final items = [
        {'id': 'child + / & ? #', 'quantity': 2},
      ];
      final api = apiFor((request) async {
        expect(request.method, 'GET');
        expect(request.url.path, '/api/v1/shipping');
        expect(request.url.queryParameters.keys.toSet(), {'country', 'items'});
        expect(request.url.queryParameters['country'], 'CA');
        expect(jsonDecode(request.url.queryParameters['items']!), items);
        expect(request.url.fragment, isEmpty);
        return response(
          shippingFixture(
            country: 'CA',
            subtotalCents: 31400,
            shippingCents: 2475,
            availableMethods: const ['express'],
          ),
        );
      });
      final quotes = await api.shippingQuotes('CA', items);
      expect(quotes.configured, isTrue);
      expect(quotes.subtotalCents, 31400);
      expect(quotes.revision, shippingRevisionFixture);
      expect(quotes.available.single.method, 'express');
      expect(quotes.available.single.shippingCents, 2475);
    },
  );

  test(
    'No-route response stays successful with no selectable quotes',
    () async {
      final api = apiFor(
        (_) async => response(shippingFixture(availableMethods: const [])),
      );
      final quotes = await api.shippingQuotes('US', [
        {'id': 'nova', 'quantity': 1},
      ]);
      expect(quotes.available, isEmpty);
      expect(
        quotes.quotes.every((quote) => quote.shippingCents == null),
        isTrue,
      );
    },
  );

  test(
    'Unconfigured server fallback is accepted without client rate guesses',
    () async {
      final api = apiFor(
        (_) async =>
            response(shippingFixture(configured: false, shippingCents: 0)),
      );
      final quotes = await api.shippingQuotes('US', [
        {'id': 'nova', 'quantity': 1},
      ]);
      expect(quotes.configured, isFalse);
      expect(quotes.available.single.shippingCents, 0);
    },
  );

  final invalidResponses = <String, void Function(Map<String, dynamic>)>{
    'country mismatch': (json) => json['country'] = 'CA',
    'unsupported country': (json) => json['country'] = 'ZZ',
    'currency mismatch': (json) => json['currency'] = 'EUR',
    'API version mismatch': (json) => json['apiVersion'] = 'v2',
    'negative subtotal': (json) => json['subtotalCents'] = -1,
    'fractional subtotal': (json) => json['subtotalCents'] = 100.5,
    'negative weight': (json) => json['weightGrams'] = -1,
    'invalid configured': (json) => json['configured'] = 'true',
    'missing revision': (json) => json.remove('revision'),
    'malformed revision': (json) => json['revision'] = 'old',
    'quote country mismatch': (json) => json['quotes'][0]['country'] = 'CA',
    'quote revision mismatch': (json) =>
        json['quotes'][0]['revision'] = 'b' * 64,
    'duplicate methods': (json) => json['quotes'][1]['method'] = 'standard',
    'unknown method': (json) => json['quotes'][0]['method'] = 'teleport',
    'missing available rate': (json) =>
        json['quotes'][0]['shippingCents'] = null,
    'negative rate': (json) => json['quotes'][0]['shippingCents'] = -1,
    'missing delivery estimate': (json) => json['quotes'][0]['minDays'] = null,
    'reversed delivery estimate': (json) => json['quotes'][0]['maxDays'] = 1,
    'too many quotes': (json) => json['quotes'].add(json['quotes'][0]),
  };
  for (final entry in invalidResponses.entries) {
    test('Rejects invalid shipping response: ${entry.key}', () async {
      final body = shippingFixture();
      entry.value(body);
      final api = apiFor((_) async => response(body));
      await expectLater(
        api.shippingQuotes('US', [
          {'id': 'nova', 'quantity': 1},
        ]),
        throwsA(isA<ApiException>()),
      );
    });
  }

  for (final failure in ['HTTP', 'network', 'JSON']) {
    test('Shipping $failure failure is an API error', () async {
      final api = apiFor((_) async {
        if (failure == 'network') throw http.ClientException('offline');
        if (failure == 'JSON') return http.Response('{broken', 200);
        return response({'ok': false, 'message': 'Offline'}, status: 503);
      });
      await expectLater(
        api.shippingQuotes('US', [
          {'id': 'nova', 'quantity': 1},
        ]),
        throwsA(isA<ApiException>()),
      );
    });
  }

  test('Order request preserves selected shipping revision', () async {
    final api = apiFor((request) async {
      expect(request.method, 'POST');
      expect(request.url.path, '/api/v1/orders');
      expect(
        jsonDecode(request.body)['shippingRevision'],
        shippingRevisionFixture,
      );
      expect(jsonDecode(request.body)['deliveryMethod'], 'express');
      return response({
        'ok': true,
        'orderNumber': 'MW-SHIPPING',
        'totalCents': 14730,
      });
    });
    expect(
      (await api.createOrder({
        'shippingRevision': shippingRevisionFixture,
        'deliveryMethod': 'express',
      })).orderNumber,
      'MW-SHIPPING',
    );
  });
}
