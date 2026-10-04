import 'package:shared_preferences/shared_preferences.dart';

abstract interface class LocalDrafts {
  Future<String?> read();
  Future<void> write(String value);
}

// Non-authoritative device-local preferences only. Orders stay on the server.
class DeviceDrafts implements LocalDrafts {
  final _prefs = SharedPreferencesAsync();
  static const _key = 'miova_app_draft_v1';
  @override
  Future<String?> read() => _prefs.getString(_key);
  @override
  Future<void> write(String value) => _prefs.setString(_key, value);
}
