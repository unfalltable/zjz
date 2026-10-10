import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:miova_app/data/commerce_api.dart';

import 'test_support.dart';

Map<String, dynamic> product(String id) => {
  ...(catalogFixture['products'] as List).first as Map<String, dynamic>,
  'id': id,
  'name': 'Product $id',
};

Map<String, dynamic> page(
  List<String> ids, {
  bool? hasMore,
  String? nextCursor,
}) => {
  ...catalogFixture,
  'products': ids.map(product).toList(),
  if (hasMore != null)
    'pageInfo': {'hasMore': hasMore, 'nextCursor': nextCursor},
};

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
    'Legacy single-page catalog stays compatible without pageInfo',
    () async {
      var calls = 0;
      final api = apiFor((request) async {
        calls += 1;
        expect(request.method, 'GET');
        expect(request.url.toString(), 'https://store.example/api/v1/catalog');
        return response(page(['legacy']));
      });
      final catalog = await api.catalog();
      expect(catalog.products.single.id, 'legacy');
      expect(catalog.destinations, catalogFixture['destinations']);
      expect(calls, 1);
    },
  );

  test(
    'An empty final catalog is a successful catalog, not an error',
    () async {
      final api = apiFor((_) async => response(page([], hasMore: false)));
      expect((await api.catalog()).products, isEmpty);
    },
  );

  test('Aggregates 501 products across all 11 cursor pages in order', () async {
    final requested = <Uri>[];
    final api = apiFor((request) async {
      requested.add(request.url);
      final cursor = request.url.queryParameters['cursor'];
      final start = cursor == null ? 0 : int.parse(cursor.substring(7));
      final end = (start + 50).clamp(0, 501);
      expect(request.method, 'GET');
      expect(request.url.path, '/api/v1/catalog');
      expect(
        request.url.queryParameters.keys,
        cursor == null ? isEmpty : ['cursor'],
      );
      return response(
        page(
          [for (var index = start; index < end; index++) 'sku-$index'],
          hasMore: end < 501,
          nextCursor: end < 501 ? 'offset-$end' : null,
        ),
      );
    });
    final catalog = await api.catalog();
    expect(requested.length, 11);
    expect(requested.first.query, isEmpty);
    expect(catalog.products.map((item) => item.id), [
      for (var index = 0; index < 501; index++) 'sku-$index',
    ]);
    expect(catalog.destinations, catalogFixture['destinations']);
  });

  test('Opaque cursor is encoded without adding query parameters', () async {
    const cursor = 'a+b/c==&limit=100#next?';
    var calls = 0;
    final api = apiFor((request) async {
      calls += 1;
      if (calls == 1) {
        expect(request.url.query, isEmpty);
        return response(page(['one'], hasMore: true, nextCursor: cursor));
      }
      expect(request.url.queryParameters, {'cursor': cursor});
      expect(request.url.fragment, isEmpty);
      return response(page(['two'], hasMore: false));
    });
    expect((await api.catalog()).products.length, 2);
    expect(calls, 2);
  });

  for (final finalPage in [true, false]) {
    test(
      '1000-page ceiling accepts only a complete catalog ($finalPage)',
      () async {
        var calls = 0;
        final api = apiFor((_) async {
          calls += 1;
          final hasMore = !finalPage || calls < 1000;
          return response(
            page(
              ['item-$calls'],
              hasMore: hasMore,
              nextCursor: hasMore ? 'next-$calls' : null,
            ),
          );
        });
        if (finalPage) {
          expect((await api.catalog()).products.length, 1000);
        } else {
          await expectLater(api.catalog(), throwsA(isA<ApiException>()));
        }
        expect(calls, 1000);
      },
    );
  }

  final invalidPageInfo = <String, dynamic>{
    'null envelope': null,
    'list envelope': [],
    'string envelope': 'next',
    'missing hasMore': {'nextCursor': null},
    'string hasMore': {'hasMore': 'false', 'nextCursor': null},
    'numeric hasMore': {'hasMore': 1, 'nextCursor': 'next'},
    'missing nextCursor': {'hasMore': false},
    'hasMore without cursor': {'hasMore': true, 'nextCursor': null},
    'empty cursor': {'hasMore': true, 'nextCursor': ''},
    'blank cursor': {'hasMore': true, 'nextCursor': '  '},
    'numeric cursor': {'hasMore': true, 'nextCursor': 1},
    'oversized cursor': {'hasMore': true, 'nextCursor': 'x' * 4097},
    'final cursor': {'hasMore': false, 'nextCursor': 'unexpected'},
  };
  for (final entry in invalidPageInfo.entries) {
    test('Rejects malformed pageInfo: ${entry.key}', () async {
      var calls = 0;
      final api = apiFor((_) async {
        calls += 1;
        return response({
          ...page(['one']),
          'pageInfo': entry.value,
        });
      });
      await expectLater(api.catalog(), throwsA(isA<ApiException>()));
      expect(calls, 1);
    });
  }

  test('A subsequent page cannot omit the pagination envelope', () async {
    var calls = 0;
    final api = apiFor((_) async {
      calls += 1;
      return response(
        calls == 1
            ? page(['one'], hasMore: true, nextCursor: 'next')
            : page(['two']),
      );
    });
    await expectLater(api.catalog(), throwsA(isA<ApiException>()));
    expect(calls, 2);
  });

  test('An empty page claiming more products is rejected', () async {
    final api = apiFor(
      (_) async => response(page([], hasMore: true, nextCursor: 'next')),
    );
    await expectLater(api.catalog(), throwsA(isA<ApiException>()));
  });

  test('Duplicate product IDs within a legacy page are rejected', () async {
    final api = apiFor((_) async => response(page(['same', 'same'])));
    await expectLater(api.catalog(), throwsA(isA<ApiException>()));
  });

  test('Duplicate product IDs across pages are rejected', () async {
    var calls = 0;
    final api = apiFor((_) async {
      calls += 1;
      return response(
        page(
          ['same'],
          hasMore: calls == 1,
          nextCursor: calls == 1 ? 'next' : null,
        ),
      );
    });
    await expectLater(api.catalog(), throwsA(isA<ApiException>()));
    expect(calls, 2);
  });

  test('Repeated cursor is rejected before making another request', () async {
    var calls = 0;
    final api = apiFor((_) async {
      calls += 1;
      return response(page(['item-$calls'], hasMore: true, nextCursor: 'same'));
    });
    await expectLater(api.catalog(), throwsA(isA<ApiException>()));
    expect(calls, 2);
  });

  test('A multi-step cursor cycle is rejected', () async {
    var calls = 0;
    final api = apiFor((_) async {
      calls += 1;
      return response(
        page(
          ['item-$calls'],
          hasMore: true,
          nextCursor: calls == 2 ? 'b' : 'a',
        ),
      );
    });
    await expectLater(api.catalog(), throwsA(isA<ApiException>()));
    expect(calls, 3);
  });

  test('Catalog is not resolved until the final page completes', () async {
    final lastPage = Completer<http.Response>();
    final requestedLastPage = Completer<void>();
    var calls = 0;
    final api = apiFor((_) async {
      calls += 1;
      if (calls == 1) {
        return response(page(['one'], hasMore: true, nextCursor: 'next'));
      }
      requestedLastPage.complete();
      return lastPage.future;
    });
    var finished = false;
    final future = api.catalog().then((catalog) {
      finished = true;
      return catalog;
    });
    await requestedLastPage.future;
    expect(finished, isFalse);
    lastPage.complete(response(page(['two'], hasMore: false)));
    expect((await future).products.map((item) => item.id), ['one', 'two']);
  });

  final laterFailures = <String, Future<http.Response> Function()>{
    'HTTP error': () async =>
        response({'ok': false, 'message': 'Offline'}, status: 503),
    'network error': () async => throw http.ClientException('Offline'),
    'malformed JSON': () async => http.Response('{invalid', 200),
    'invalid product': () async => response({
      ...page(['two'], hasMore: false),
      'products': [
        {'id': 'two'},
      ],
    }),
    'malformed pageInfo': () async => response({
      ...page(['two']),
      'pageInfo': {'hasMore': true, 'nextCursor': null},
    }),
  };
  for (final entry in laterFailures.entries) {
    test(
      'Later ${entry.key} never replaces the old StoreModel catalog',
      () async {
        var calls = 0;
        final model = testModel(
          client: MockClient((_) async {
            calls += 1;
            if (calls == 1) return response(catalogFixture);
            if (calls == 2) {
              return response(
                page(['partial'], hasMore: true, nextCursor: 'next'),
              );
            }
            return entry.value();
          }),
        );
        addTearDown(model.dispose);
        await model.initialize();
        final original = model.catalog;
        model.quantity('nova', 1);
        model.toggleFavorite('nova');
        await model.reload();
        expect(calls, 3);
        expect(model.catalog, same(original));
        expect(model.catalog!.products.single.id, 'nova');
        expect(model.product('partial'), isNull);
        expect(model.bag, {'nova': 1});
        expect(model.favorites, {'nova'});
        expect(model.error, isNotNull);
        expect(model.loading, isFalse);
      },
    );
  }
}
