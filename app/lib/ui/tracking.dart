import 'package:flutter/material.dart';

import '../data/models.dart';
import '../l10n/strings.dart';
import 'store_scope.dart';

class TrackingScreen extends StatefulWidget {
  const TrackingScreen({super.key});
  @override
  State<TrackingScreen> createState() => _TrackingScreenState();
}

class _TrackingScreenState extends State<TrackingScreen> {
  final _form = GlobalKey<FormState>();
  final _number = TextEditingController(), _email = TextEditingController();
  bool _loading = false;
  String? _error;
  Map<String, dynamic>? _order;
  Future<void> _lookup() async {
    if (!_form.currentState!.validate()) return;
    final api = StoreScope.of(context).api;
    setState(() {
      _loading = true;
      _error = null;
      _order = null;
    });
    try {
      final result = await api.track(
        _number.text.trim().toUpperCase(),
        _email.text.trim(),
      );
      if (mounted) setState(() => _order = result);
    } catch (exception) {
      if (mounted) setState(() => _error = exception.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final copy = Copy(StoreScope.of(context).locale);
    return Form(
      key: _form,
      child: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            copy.t('track'),
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          const SizedBox(height: 16),
          Text(copy.t('lookupHint')),
          const SizedBox(height: 24),
          TextFormField(
            controller: _number,
            enabled: !_loading,
            decoration: InputDecoration(
              labelText: copy.t('number'),
              hintText: 'MW-123456',
            ),
            textCapitalization: TextCapitalization.characters,
            validator: (value) =>
                RegExp(r'^MW-\d{5,8}$')
                    .hasMatch(value?.trim().toUpperCase() ?? '')
                ? null
                : copy.t('required'),
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _email,
            enabled: !_loading,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email],
            decoration: InputDecoration(labelText: copy.t('email')),
            validator: (value) =>
                RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
                    .hasMatch(value?.trim() ?? '')
                ? null
                : copy.t('required'),
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _loading ? null : _lookup,
            child: _loading
                ? const SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(copy.t('lookup')),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 24),
              child: Semantics(
                liveRegion: true,
                child: Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            ),
          if (_order != null)
            Card(
              margin: const EdgeInsets.only(top: 24),
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SelectableText(
                      _order!['orderNumber'] as String,
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 16),
                    Text(_order!['productName'] as String),
                    const SizedBox(height: 8),
                    Text(money(_order!['amountCents'] as int)),
                    const SizedBox(height: 16),
                    Text(copy.t(_order!['status'] as String)),
                    const SizedBox(height: 16),
                    LinearProgressIndicator(
                      value: (_order!['progress'] as num) / 100,
                    ),
                    if (_order!['paymentStatus'] == 'pending')
                      Padding(
                        padding: const EdgeInsets.only(top: 24),
                        child: Text(copy.t('paymentNotice')),
                      ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _number.dispose();
    _email.dispose();
    super.dispose();
  }
}
