import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../data/models.dart';
import '../data/shipping.dart';
import '../l10n/strings.dart';
import '../state/store_model.dart';
import 'shop.dart';
import 'store_scope.dart';

class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key});
  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  final _form = GlobalKey<FormState>();
  final _fields = {
    for (final key in [
      'email',
      'firstName',
      'lastName',
      'address',
      'apartment',
      'city',
      'region',
      'postal',
      'phone',
    ])
      key: TextEditingController(),
  };
  String? _delivery;
  ShippingQuotes? _quotes;
  String? _quoteKey;
  Catalog? _quotedCatalog;
  bool _quoteEnabled = false, _quoteLoading = false, _quoteFailed = false;
  int _quoteRequest = 0;
  String? _error;
  bool _saving = false;
  OrderReceipt? _receipt;
  List<Map<String, dynamic>> _items(StoreModel model) {
    final ids = model.bag.keys.toList()..sort();
    return [
      for (final id in ids) {'id': id, 'quantity': model.bag[id]!},
    ];
  }

  String _fingerprint(StoreModel model) =>
      jsonEncode({'country': model.destination, 'items': _items(model)});

  bool _canQuote(StoreModel model) =>
      model.catalog != null &&
      !model.loading &&
      model.error == null &&
      model.count > 0 &&
      _receipt == null;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final model = StoreScope.of(context);
    if (_quoteKey != _fingerprint(model) ||
        !identical(_quotedCatalog, model.catalog) ||
        _quoteEnabled != _canQuote(model)) {
      _refreshQuote(model);
    }
  }

  // Called during dependency changes, or inside setState for an explicit retry.
  void _refreshQuote(StoreModel model) {
    final request = ++_quoteRequest;
    final preferredMethod = _delivery;
    _quoteKey = _fingerprint(model);
    _quotedCatalog = model.catalog;
    _quoteEnabled = _canQuote(model);
    _quotes = null;
    _quoteFailed = false;
    _quoteLoading = _quoteEnabled;
    if (_quoteEnabled) {
      unawaited(
        _loadQuote(
          model,
          request,
          model.destination,
          _items(model),
          preferredMethod,
        ),
      );
    }
  }

  bool _currentRequest(StoreModel model, int request) =>
      mounted &&
      request == _quoteRequest &&
      _canQuote(model) &&
      _quoteKey == _fingerprint(model) &&
      identical(_quotedCatalog, model.catalog);

  Future<void> _loadQuote(
    StoreModel model,
    int request,
    String country,
    List<Map<String, dynamic>> items,
    String? preferredMethod,
  ) async {
    try {
      final quotes = await model.api.shippingQuotes(country, items);
      if (!_currentRequest(model, request)) return;
      setState(() {
        _quotes = quotes;
        final available = quotes.available;
        _delivery = available.any((route) => route.method == preferredMethod)
            ? preferredMethod
            : available.isEmpty
            ? null
            : available.first.method;
        _quoteLoading = false;
      });
    } catch (_) {
      if (!_currentRequest(model, request)) return;
      setState(() {
        _quoteFailed = true;
        _quoteLoading = false;
      });
    }
  }

  ShippingQuote? _selectedQuote(StoreModel model) {
    if (!_currentRequest(model, _quoteRequest) ||
        _quoteLoading ||
        _quoteFailed) {
      return null;
    }
    for (final quote in _quotes?.available ?? <ShippingQuote>[]) {
      if (quote.method == _delivery) return quote;
    }
    return null;
  }

  Future<void> _save(StoreModel model) async {
    final quote = _selectedQuote(model), quotes = _quotes;
    if (_saving || quote == null || quotes == null) return;
    if (!_form.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    final input = <String, dynamic>{
      for (final entry in _fields.entries) entry.key: entry.value.text.trim(),
      'destination': model.destination,
      'deliveryMethod': quote.method,
      'shippingRevision': quotes.revision,
      'expectedSubtotalCents': quotes.subtotalCents,
      'expectedShippingCents': quote.shippingCents!,
      'marketingOptIn': false,
      'website': '',
      'items': _items(model),
    };
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      input['idempotencyKey'] = await model.checkoutKeyFor(input);
      // Local persistence may yield while the destination or bag changes.
      if (!mounted) return;
      if (!identical(_quotes, quotes) || _selectedQuote(model) != quote) {
        setState(() => _error = Copy(model.locale).t('shippingChanged'));
        return;
      }
      final receipt = await model.api.createOrder(input);
      model.clearBag();
      if (!mounted) return;
      setState(() => _receipt = receipt);
    } catch (exception) {
      if (mounted) {
        setState(() {
          _error = exception.toString();
          _refreshQuote(model);
        });
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final model = StoreScope.of(context), copy = Copy(model.locale);
    final quote = _selectedQuote(model);
    final quotes = _currentRequest(model, _quoteRequest) ? _quotes : null;
    if (model.catalog == null || model.error != null || model.loading) {
      return Scaffold(
        appBar: AppBar(title: Text(copy.t('delivery'))),
        body: SafeArea(
          child: model.loading
              ? CatalogLoading(copy: copy)
              : CatalogUnavailable(copy: copy, retry: model.reload),
        ),
      );
    }
    return PopScope(
      canPop: !_saving,
      child: Scaffold(
        appBar: AppBar(
          title: Text(copy.t('delivery')),
          leading: IconButton(
            tooltip: copy.t('back'),
            icon: const Icon(Icons.arrow_back),
            onPressed: _saving
                ? null
                : () => context.canPop() ? context.pop() : context.go('/bag'),
          ),
        ),
        body: SafeArea(
          child: Align(
            alignment: Alignment.topCenter,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 680),
              child: _receipt != null
                  ? ListView(
                      padding: const EdgeInsets.all(24),
                      children: [
                        const Icon(Icons.check_circle_outline, size: 64),
                        const SizedBox(height: 24),
                        Text(
                          copy.t('pending'),
                          style: Theme.of(context).textTheme.headlineMedium,
                        ),
                        const SizedBox(height: 24),
                        SelectableText(
                          '${copy.t('number')}: ${_receipt!.orderNumber}',
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        const SizedBox(height: 16),
                        Text(
                          '${copy.t('total')}: ${money(_receipt!.totalCents)}',
                        ),
                        const SizedBox(height: 24),
                        Text(copy.t('paymentNotice')),
                        const SizedBox(height: 16),
                        Text(
                          '${copy.t('taxes')}: ${copy.t('taxNotEstimated')}',
                        ),
                        const SizedBox(height: 24),
                        FilledButton(
                          onPressed: () => context.go('/track'),
                          child: Text(copy.t('track')),
                        ),
                      ],
                    )
                  : model.count == 0
                  ? SingleChildScrollView(child: EmptyFinds(copy: copy))
                  : Form(
                      key: _form,
                      child: AutofillGroup(
                        child: ListView(
                          padding: const EdgeInsets.all(24),
                          children: [
                            Card(
                              child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Text(copy.t('paymentNotice')),
                              ),
                            ),
                            const SizedBox(height: 16),
                            if (_error != null) ...[
                              Semantics(
                                liveRegion: true,
                                child: Text(
                                  _error!,
                                  style: TextStyle(
                                    color: Theme.of(context).colorScheme.error,
                                  ),
                                ),
                              ),
                              const SizedBox(height: 16),
                            ],
                            ..._fields.entries.map(
                              (entry) => Padding(
                                padding: const EdgeInsets.only(bottom: 16),
                                child: TextFormField(
                                  key: ValueKey('checkout-${entry.key}'),
                                  controller: entry.value,
                                  enabled: !_saving,
                                  decoration: InputDecoration(
                                    labelText: copy.t(entry.key),
                                  ),
                                  keyboardType: entry.key == 'email'
                                      ? TextInputType.emailAddress
                                      : entry.key == 'phone'
                                      ? TextInputType.phone
                                      : TextInputType.text,
                                  textInputAction: TextInputAction.next,
                                  autofillHints: _autofill[entry.key],
                                  maxLength: _limits[entry.key],
                                  validator: (value) {
                                    final text = value?.trim() ?? '';
                                    if (entry.key == 'apartment' ||
                                        entry.key == 'region') {
                                      return null;
                                    }
                                    if (text.length <
                                        (_minimums[entry.key] ?? 1)) {
                                      return copy.t('required');
                                    }
                                    if (entry.key == 'email' &&
                                        !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
                                            .hasMatch(text)) {
                                      return copy.t('required');
                                    }
                                    if (entry.key == 'phone' &&
                                        (!RegExp(r'^\+?[0-9\s().-]+$')
                                                .hasMatch(text) ||
                                            text
                                                    .replaceAll(
                                                      RegExp(r'\D'),
                                                      '',
                                                    )
                                                    .length <
                                                7)) {
                                      return copy.t('required');
                                    }
                                    return null;
                                  },
                                ),
                              ),
                            ),
                            DropdownButtonFormField<String>(
                              key: ValueKey(model.destination),
                              initialValue: model.destination,
                              decoration: InputDecoration(
                                labelText: copy.t('country'),
                              ),
                              items: model.catalog!.destinations.entries
                                  .map(
                                    (entry) => DropdownMenuItem(
                                      value: entry.key,
                                      child: Text(
                                        entry.value[model.locale] ?? entry.key,
                                      ),
                                    ),
                                  )
                                  .toList(),
                              onChanged: _saving
                                  ? null
                                  : (value) {
                                      if (value != null) {
                                        model.setDestination(value);
                                      }
                                    },
                            ),
                            const SizedBox(height: 24),
                            if (_quoteLoading)
                              Semantics(
                                liveRegion: true,
                                child: Text(copy.t('shippingLoading')),
                              )
                            else if (_quoteFailed || quotes == null) ...[
                              Semantics(
                                liveRegion: true,
                                child: Text(copy.t('shippingUnavailable')),
                              ),
                              TextButton(
                                key: const ValueKey('shipping-retry'),
                                onPressed: _saving
                                    ? null
                                    : () =>
                                          setState(() => _refreshQuote(model)),
                                child: Text(copy.t('retry')),
                              ),
                            ] else if (quotes.available.isEmpty) ...[
                              Semantics(
                                liveRegion: true,
                                child: Text(copy.t('shippingNoRoutes')),
                              ),
                              TextButton(
                                key: const ValueKey('shipping-retry'),
                                onPressed: _saving
                                    ? null
                                    : () =>
                                          setState(() => _refreshQuote(model)),
                                child: Text(copy.t('retry')),
                              ),
                            ] else
                              DropdownButtonFormField<String>(
                                key: ValueKey('shipping-$_quoteRequest'),
                                initialValue: _delivery,
                                isExpanded: true,
                                decoration: InputDecoration(
                                  labelText: copy.t('shipping'),
                                ),
                                items: quotes.available
                                    .map(
                                      (route) => DropdownMenuItem(
                                        value: route.method,
                                        child: Text(
                                          '${copy.t(route.method)} · ${money(route.shippingCents!)} · ${route.minDays}–${route.maxDays} ${copy.t('days')}',
                                        ),
                                      ),
                                    )
                                    .toList(),
                                onChanged: _saving
                                    ? null
                                    : (value) =>
                                          setState(() => _delivery = value),
                              ),
                            const SizedBox(height: 24),
                            ...model.bag.entries.map((entry) {
                              final sku = model.sku(entry.key);
                              final label = sku == null
                                  ? copy.t('productUnavailable')
                                  : '${sku.name}${sku.variantLabel.isEmpty ? '' : ' · ${sku.variantLabel}'}';
                              return Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: Text(
                                  '$label × ${entry.value}${sku == null ? '' : ' · ${money(sku.priceCents * entry.value)}'}',
                                ),
                              );
                            }),
                            const Divider(height: 32),
                            Text(
                              '${copy.t('subtotal')}: ${quotes == null ? '—' : money(quotes.subtotalCents)}',
                            ),
                            const SizedBox(height: 8),
                            Text(
                              '${copy.t('shipping')}: ${quote == null ? '—' : money(quote.shippingCents!)}',
                            ),
                            const SizedBox(height: 8),
                            Text(
                              '${copy.t('taxes')}: ${copy.t('taxNotEstimated')}',
                            ),
                            const SizedBox(height: 16),
                            Text(
                              '${copy.t('total')}: ${quote == null || quotes == null ? '—' : money(quotes.subtotalCents + quote.shippingCents!)}',
                              style: Theme.of(context).textTheme.titleLarge,
                            ),
                            const SizedBox(height: 24),
                            FilledButton(
                              key: const ValueKey('checkout-save'),
                              onPressed: _saving || quote == null
                                  ? null
                                  : () => _save(model),
                              child: _saving
                                  ? const SizedBox(
                                      width: 24,
                                      height: 24,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                      ),
                                    )
                                  : Text(copy.t('saveOrder')),
                            ),
                          ],
                        ),
                      ),
                    ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    for (final field in _fields.values) {
      field.dispose();
    }
    super.dispose();
  }
}

const _minimums = {'address': 3, 'postal': 3, 'phone': 7};
const _limits = {
  'email': 254,
  'firstName': 80,
  'lastName': 80,
  'address': 180,
  'apartment': 80,
  'city': 100,
  'region': 100,
  'postal': 20,
  'phone': 30,
};
const _autofill = {
  'email': [AutofillHints.email],
  'firstName': [AutofillHints.givenName],
  'lastName': [AutofillHints.familyName],
  'address': [AutofillHints.streetAddressLine1],
  'apartment': [AutofillHints.streetAddressLine2],
  'city': [AutofillHints.addressCity],
  'region': [AutofillHints.addressState],
  'postal': [AutofillHints.postalCode],
  'phone': [AutofillHints.telephoneNumber],
};
