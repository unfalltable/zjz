import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'app.dart';
import 'data/commerce_api.dart';
import 'data/local_drafts.dart';
import 'state/store_model.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  const endpoint = String.fromEnvironment('MIOVA_API_BASE_URL');
  final uri = endpoint.isNotEmpty
      ? Uri.tryParse(endpoint)
      : (kIsWeb ? Uri.base : null);
  if (uri == null ||
      !uri.hasAuthority ||
      (kReleaseMode &&
          uri.scheme != 'https' &&
          !(kIsWeb && ['localhost', '127.0.0.1'].contains(uri.host))) ||
      !['http', 'https'].contains(uri.scheme)) {
    runApp(
      const MaterialApp(
        home: Scaffold(
          body: SafeArea(
            child: Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'Store connection is not configured. Set MIOVA_API_BASE_URL to your HTTPS commerce API before building the app.',
                ),
              ),
            ),
          ),
        ),
      ),
    );
    return;
  }
  final model = StoreModel(
    api: CommerceApi(baseUrl: uri),
    drafts: DeviceDrafts(),
  );
  runApp(MiovaApp(model: model));
  model.initialize();
}
