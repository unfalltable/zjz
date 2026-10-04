import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../data/models.dart';
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
  String _delivery = 'standard';
  String? _error;
  bool _saving = false;
  OrderReceipt? _receipt;
  int _shipping(int subtotal) => _delivery == 'standard'
      ? (subtotal >= 7500 ? 0 : 890)
      : (_delivery == 'express' ? 1890 : 3200);

  Future<void> _save(StoreModel model) async {
    if (!_form.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    final input = <String, dynamic>{
      for (final entry in _fields.entries) entry.key: entry.value.text.trim(),
      'destination': model.destination,
      'deliveryMethod': _delivery,
      'marketingOptIn': false,
      'website': '',
      'items': model.bag.entries
          .map((entry) => {'id': entry.key, 'quantity': entry.value})
          .toList(),
    };
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      input['idempotencyKey'] = await model.checkoutKeyFor(input);
      final receipt = await model.api.createOrder(input);
      model.clearBag();
      if (!mounted) return;
      setState(() => _receipt = receipt);
    } catch (exception) {
      if (mounted) setState(() => _error = exception.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final model = StoreScope.of(context), copy = Copy(model.locale);
    if (model.catalog == null) {
      return Scaffold(
        appBar: AppBar(title: Text(copy.t('delivery'))),
        body: const ShopScreen(),
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
                        const SizedBox(height: 24),
                        FilledButton(
                          onPressed: () => context.go('/track'),
                          child: Text(copy.t('track')),
                        ),
                      ],
                    )
                  : model.count == 0
                  ? EmptyFinds(copy: copy)
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
                                    return null;
                                  },
                                ),
                              ),
                            ),
                            DropdownButtonFormField<String>(
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
                            DropdownButtonFormField<String>(
                              initialValue: _delivery,
                              decoration: InputDecoration(
                                labelText: copy.t('shipping'),
                              ),
                              items: ['standard', 'express', 'priority']
                                  .map(
                                    (value) => DropdownMenuItem(
                                      value: value,
                                      child: Text(copy.t(value)),
                                    ),
                                  )
                                  .toList(),
                              onChanged: _saving
                                  ? null
                                  : (value) =>
                                        setState(() => _delivery = value!),
                            ),
                            const SizedBox(height: 24),
                            ...model.bag.entries.map(
                              (entry) => Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: Text(
                                  '${model.product(entry.key)!.name} × ${entry.value} · ${money(model.product(entry.key)!.priceCents * entry.value)}',
                                ),
                              ),
                            ),
                            const Divider(height: 32),
                            Text(
                              '${copy.t('subtotal')}: ${money(model.subtotal)}',
                            ),
                            const SizedBox(height: 8),
                            Text(
                              '${copy.t('shipping')}: ${money(_shipping(model.subtotal))}',
                            ),
                            const SizedBox(height: 16),
                            Text(
                              '${copy.t('total')}: ${money(model.subtotal + _shipping(model.subtotal))}',
                              style: Theme.of(context).textTheme.titleLarge,
                            ),
                            const SizedBox(height: 24),
                            FilledButton(
                              onPressed: _saving ? null : () => _save(model),
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
